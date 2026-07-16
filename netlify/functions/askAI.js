const API_URL = "https://openrouter.ai/api/v1/chat/completions";

// ─── Configuration ───────────────────────────────────────────────────────────
const REQUEST_TIMEOUT_MS = 8000;   // Per-provider timeout (8s)
const MAX_ELAPSED_MS = 9500;       // Total function timeout buffer (9.5s < Netlify 10s)
const MAX_PROMPT_LENGTH = 8000;     // Max characters per user message
const MAX_MESSAGES = 20;           // Max messages in the array
const MAX_INPUT_BYTES = 50000;     // Max total body size
const CORS_ORIGIN = "https://friendly-ai-ad09f.firebaseapp.com";
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX = 30;          // Max requests per window per IP

// ─── Simple in-memory rate limiter ───────────────────────────────────────────
const rateLimitStore = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const record = rateLimitStore.get(ip);

  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { windowStart: now, count: 1 });
    return false;
  }

  record.count += 1;
  if (record.count > RATE_LIMIT_MAX) {
    return true;
  }
  return false;
}

// ─── Periodic cleanup of old rate-limit entries ──────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitStore) {
    if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(ip);
    }
  }
}, 60000).unref();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getKeys() {
  const raw = process.env.OPENROUTER_KEYS || "";
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

function getModels() {
  const raw =
    process.env.OPENROUTER_MODELS ||
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free,openrouter/auto";

  return raw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

async function verifyFirebaseToken(idToken) {
  if (!idToken) {
    throw new Error("No auth token provided");
  }

  const apiKey = process.env.FIREBASE_API_KEY;
  console.log("=== Environment Check ===");
  console.log("FIREBASE_API_KEY:", process.env.FIREBASE_API_KEY ? "FOUND" : "MISSING");
  console.log("OPENROUTER_KEYS:", process.env.OPENROUTER_KEYS ? "FOUND" : "MISSING");
  console.log("NODE_ENV:", process.env.NODE_ENV);

  if (!apiKey) {
    throw new Error("FIREBASE_API_KEY is not configured");
  }

  const response = await fetchWithTimeout(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ idToken }),
    },
    3000
  );

  if (!response.ok) {
    throw new Error("Invalid or expired Firebase ID token");
  }

  const data = await response.json();
  const user = data.users?.[0];

  if (!user) {
    throw new Error("User not found");
  }

  return {
    uid: user.localId,
    email: user.email || "",
    displayName: user.displayName || "",
  };
}

/**
 * Fetch with a timeout. Throws if the request takes longer than `ms`.
 */
async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Main handler ────────────────────────────────────────────────────────────

exports.handler = async (event, context) => {
  const startTime = Date.now();

  // ── CORS preflight ───────────────────────────────────────────────────────
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": CORS_ORIGIN,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    };
  }

  // ── Method check ─────────────────────────────────────────────────────────
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Access-Control-Allow-Origin": CORS_ORIGIN },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // ── Rate limiting ────────────────────────────────────────────────────────
  const clientIp =
    event.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    event.headers["client-ip"] ||
    "unknown";

  if (isRateLimited(clientIp)) {
    console.warn(`Rate limited IP: ${clientIp}`);
    return {
      statusCode: 429,
      headers: {
        "Access-Control-Allow-Origin": CORS_ORIGIN,
        "Retry-After": "60",
      },
      body: JSON.stringify({
        error: "rate-limited",
        message: "Too many requests. Please try again in a minute.",
      }),
    };
  }

  // ── Input size check ─────────────────────────────────────────────────────
  const bodyRaw = event.body || "";
  if (Buffer.byteLength(bodyRaw, "utf-8") > MAX_INPUT_BYTES) {
    return {
      statusCode: 413,
      headers: { "Access-Control-Allow-Origin": CORS_ORIGIN },
      body: JSON.stringify({ error: "payload-too-large", message: "Request body too large." }),
    };
  }

  // ── Authenticate ─────────────────────────────────────────────────────────
  const authHeader = event.headers.authorization || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  let user;
  try {
    user = await verifyFirebaseToken(idToken);
  } catch (err) {
    console.error(err);

    return {
      statusCode: 401,
      headers: { "Access-Control-Allow-Origin": CORS_ORIGIN },
      body: JSON.stringify({
        error: "unauthenticated",
        message: "You must be signed in to use Friendly-AI.",
      }),
    };
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let data;
  try {
    data = JSON.parse(bodyRaw || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: { "Access-Control-Allow-Origin": CORS_ORIGIN },
      body: JSON.stringify({ error: "invalid-argument", message: "Invalid JSON body." }),
    };
  }

  // ── Validate messages ────────────────────────────────────────────────────
  let messages = data?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      statusCode: 400,
      headers: { "Access-Control-Allow-Origin": CORS_ORIGIN },
      body: JSON.stringify({ error: "invalid-argument", message: "messages array is required." }),
    };
  }

  // Enforce size limits
  if (messages.length > MAX_MESSAGES) {
    messages = messages.slice(-MAX_MESSAGES);
  }

  for (const msg of messages) {
    if (typeof msg.content === "string" && msg.content.length > MAX_PROMPT_LENGTH) {
      msg.content = msg.content.slice(0, MAX_PROMPT_LENGTH);
    }
  }

  // ── Load keys & models ───────────────────────────────────────────────────
  const keys = getKeys();
  const models = getModels();

  if (keys.length === 0) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": CORS_ORIGIN },
      body: JSON.stringify({
        error: "failed-precondition",
        message: "OpenRouter API key is not configured on the server.",
      }),
    };
  }

  const temperature = typeof data.temperature === "number" ? data.temperature : 0.7;
  const maxTokens = typeof data.maxTokens === "number" ? data.maxTokens : 2000;

  let lastError = null;

  for (let i = 0; i < keys.length; i += 1) {
    // Check cumulative timeout before trying the next provider
    if (Date.now() - startTime >= MAX_ELAPSED_MS) {
      lastError = new Error("Total execution time exceeded limit");
      console.warn("Exceeded cumulative timeout, stopping failover loop.");
      break;
    }

    // Calculate the remaining time for this provider call
    const remainingMs = Math.max(
      1000,
      MAX_ELAPSED_MS - (Date.now() - startTime)
    );
    const providerTimeout = Math.min(REQUEST_TIMEOUT_MS, remainingMs);

    // Pick a model: round-robin, fallback to first in list if models empty
    let model;
    if (models.length > 0) {
      model = models[i % models.length];
    } else {
      model = "openrouter/auto";
    }

    try {
      const response = await fetchWithTimeout(
        API_URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${keys[i]}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://friendly-ai-ad09f.firebaseapp.com",
            "X-Title": "Friendly-AI",
          },
          body: JSON.stringify({
            model,
            tools: [
              { type: "openrouter:web_search" },
              { type: "openrouter:datetime" },
            ],
            messages,
            temperature,
            max_tokens: maxTokens,
          }),
        },
        providerTimeout
      );

      if (!response.ok) {
        lastError = new Error(`Provider ${i + 1} failed (${response.status})`);
        console.warn(lastError.message);
        continue;
      }

      const result = await response.json();
      const content = result?.choices?.[0]?.message?.content;

      if (!content) {
        lastError = new Error(`Provider ${i + 1} returned no content.`);
        continue;
      }

      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": CORS_ORIGIN,
        },
        body: JSON.stringify({ content }),
      };
    } catch (err) {
      lastError = err;
      const errorName = err.name === "AbortError" ? "timeout" : err.message;
      console.warn(`Provider ${i + 1} error:`, errorName);
    }
  }

  return {
    statusCode: 503,
    headers: { "Access-Control-Allow-Origin": CORS_ORIGIN },
      body: JSON.stringify({
        error: "unavailable",
        message: "All AI providers are currently unavailable.",
      }),
  };
};