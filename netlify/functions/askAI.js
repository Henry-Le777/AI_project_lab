
const admin = require("firebase-admin");

const API_URL = "https://openrouter.ai/api/v1/chat/completions";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

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
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free,openrouter/auto,google/gemma-4-31b-it:free";
  return raw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}


exports.handler = async (event, context) => {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // 1. Authenticate: extract Firebase ID token from Authorization header
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  let user;

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    user = {
      uid: decodedToken.uid,
      email: decodedToken.email || "",
      displayName: decodedToken.name || "",
    };
  } catch (err) {
    console.error(err);

    return {
      statusCode: 401,
      body: JSON.stringify({
        error: "unauthenticated",
        message: "You must be signed in to use Friendly-AI."
      }),
    };
  }

  // 2. Parse request body
  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "invalid-argument", message: "Invalid JSON body." }),
    };
  }

  const messages = data?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "invalid-argument", message: "messages array is required." }),
    };
  }

  const keys = getKeys();
  const models = getModels();

  if (keys.length === 0) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "failed-precondition", message: "OpenRouter API key is not configured on the server." }),
    };
  }

  const temperature = typeof data.temperature === "number" ? data.temperature : 0.7;
  const maxTokens = typeof data.maxTokens === "number" ? data.maxTokens : 2000;

  let lastError = null;

  for (let i = 0; i < keys.length; i += 1) {
    const model = models[i % models.length];
    try {
      const response = await fetch(API_URL, {
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
      });

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
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ content }),
      };
    } catch (err) {
      lastError = err;
      console.warn(`Provider ${i + 1} error:`, err.message);
    }
  }

  return {
    statusCode: 503,
    body: JSON.stringify({
      error: "unavailable",
      message: lastError?.message || "All AI providers failed.",
    }),
  };
};