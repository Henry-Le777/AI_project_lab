import { auth } from "./firebase.js";

const SYSTEM_PROMPT = `Assistant name: Friendly-AI
Role: A friendly tutor
Target User: Anyone
Core feature #1: Explain by breaking things down into smaller questions with visualization examples. Breaking into topics, into questions, into points of question, into examples. The answer structure: Problem(Tell the problem/ task) - Opinion(The way to solve that problem) - Reasons(Why that way is easy to understand/ why it's true) - Evidences(Explain each step as evidence/ or give real examples) - Opinion(Summary the way of solving).
Core feature #2: Telling jokes/ stories/ real examples that taunt users in friendly-way to help the user remember their mistakes but you have to explain step-by-step fully at the end (and ask the user again to explain in their own words).
Core feature #4: Using easy-to-understand language; Break every explanation into clear, step-by-step instructions; Give constructive feedback on completed work; Teach why each step works, not just what to do; Use examples and simple real-life comparisons when helpful; 
Core feature #5: Use as resources least as possible but also most accuracy, most light-weight, fastest based on the complexity.
Refuse to: Give final answer before explaining step-by-step fully. Give out-topic answer/ too long for scalbility of the tasks. Give all step before the user want to continue. Give answer as header, not using natural langage.
Use wisely. 
Rules: Follow system_prompt fully, choose feature based on the complexity.
Conversation retrieval rule: When conversation context or topic memory is provided, use it to identify the most relevant past conversation topic before answering. If the new question seems related to an earlier chat, connect the answer to that prior topic instead of treating it as a brand-new request.
`;

// The OpenRouter API key is NOT stored in the client.
// It lives only server-side in the Netlify function (netlify/functions/askAI.js).
// The browser calls /.netlify/functions/askAI with the Firebase ID token in the
// Authorization header and the messages in the request body.

/**
 * Get the Netlify function endpoint URL.
 * In local dev (Netlify Dev) it's http://localhost:8888/.netlify/functions/askAI
 * In production it's https://<site>.netlify.app/.netlify/functions/askAI
 */
function getFunctionUrl() {
  // When running via Netlify Dev, the site URL includes the --live flag or localhost
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    // Netlify Dev typically runs on port 8888
    return "http://localhost:8888/.netlify/functions/askAI";
  }
  // Production: same origin
  return "/.netlify/functions/askAI";
}

export async function askAI(prompt, memory, username, conversationContext = "", historyContext = "", userEmail = "") {
    const displayName = typeof username === "string"
        ? username
        : username?.textContent ?? "Guest";

    try {
        // Get the current user's Firebase ID token for authentication
        const user = auth.currentUser;
        if (!user) {
            return "Please sign in to continue.";
        }
        const idToken = await user.getIdToken();

        const systemContent = `
${SYSTEM_PROMPT}

Current User:
${displayName}

User Memory:
${memory || "No memory yet."}

Conversation Context:
${conversationContext || "No recent conversation context yet."}

Recent History Context:
${historyContext || "No recent history available."}
`;

        const messages = [
            { role: "system", content: systemContent },
            { role: "user", content: prompt }
        ];

        const response = await fetch(getFunctionUrl(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken}`
            },
            body: JSON.stringify({
                messages,
                temperature: 0.7,
                maxTokens: 2000
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            if (response.status === 401) {
                return "Please sign in to continue.";
            }
            throw new Error(errorData.message || `Server error (${response.status})`);
        }

        const result = await response.json();
        const content = result?.content;

        if (!content) {
            throw new Error("Invalid AI response.");
        }

        return content;
    } catch (error) {
        console.error("AI Error:", error);
        return "Sorry, I couldn't generate a response. Please try again.";
    }
}