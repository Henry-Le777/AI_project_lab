import { auth, provider, db } from "./firebase.js";
import { askAI } from "./ai.js";
import {
    signInWithPopup,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

import {

    doc,
    getDoc,
    getDocs,
    setDoc,
    deleteDoc,
    serverTimestamp,

}
from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

import {
    collection,
    query,
    orderBy,
    limit,
    addDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const historyList =
    document.getElementById("history-list");

const signInButton = document.getElementById("sign-in-button");
const signUpButton = document.getElementById("sign-up-button");
const signOutButton = document.getElementById("sign-out-button");

const guestActions = document.getElementById("guest-actions");
const userActions = document.getElementById("user-actions");

const username = document.getElementById("username");
const avatar = document.getElementById("user-avatar");

const themeToggleButton = document.getElementById("theme-toggle-button");
const userGreeting = document.getElementById("user-greeting");

const promptForm = document.getElementById("prompt-form");
const promptInput = document.getElementById("prompt-input");
const responseContainer = document.getElementById("response-container");
const askButton = document.getElementById("ask-button");

const memoryInput =
    document.getElementById("memory-input");
const conversationContextInput =
    document.getElementById("conversation-context-input");

const saveMemoryButton =
    document.getElementById("save-memory-button");
const saveConversationContextButton =
    document.getElementById("save-context-button");

const saveButton = document.getElementById("save-button");
const refreshButton = document.getElementById("refresh-button");

let currentMemoryText = "";
let currentConversationContextText = "";

function toSafeText(value, fallback = "") {
    if (value === null || value === undefined) {
        return fallback;
    }

    return String(value).trim();
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function getCurrentUserDisplayName() {
    return auth.currentUser?.displayName || "Guest";
}

function getCurrentUserEmail() {
    return auth.currentUser?.email || "";
}

refreshButton.addEventListener("click", async () => {

    if (!auth.currentUser) return;

    await loadHistory(auth.currentUser);

});

initialize();

function renderMarkdown(content) {
    if (typeof marked !== "undefined" && typeof marked.parse === "function") {
        return marked.parse(content ?? "");
    }

    return (content ?? "").replace(/\n/g, "<br>");
}

async function renderMathJax(target) {
    if (window.MathJax?.typesetPromise) {
        await window.MathJax.typesetPromise([target]);
    }
}

function initialize() {

    console.log("main.js loaded");
    saveMemoryButton.addEventListener("click", saveMemory);
    saveConversationContextButton.addEventListener("click", saveConversationContext);
    saveButton.addEventListener("click", handleSaveInteraction);
    signInButton.addEventListener("click", handleGoogleLogin);
    signUpButton.addEventListener("click", handleGoogleLogin);
    signOutButton.addEventListener("click", handleSignOut);

    onAuthStateChanged(auth, updateUserInterface);
    themeToggleButton.addEventListener("click", toggleTheme);

    promptForm.addEventListener("submit", handlePromptSubmit);

    loadTheme();

}

async function loadHistory(user) {

    try {

        historyList.innerHTML = "";

        const q = query(

        collection(db, "users", user.uid, "history"),

        orderBy("createdAt", "desc")

        );

        const snapshot = await getDocs(q);


        for (const documentSnapshot of snapshot.docs) {

        const data = documentSnapshot.data();
        const promptText = toSafeText(data?.prompt, "No prompt");
        const answerText = toSafeText(data?.answer, "");

        const item = document.createElement("div");

        item.className = "conversation";

        item.innerHTML = `
            <div class="conversation-header">
                <div class="conversation-question">
                    <strong>You:</strong>
                    ${escapeHtml(promptText)}
                </div>
                <button
                    class="delete-history-button"
                    type="button"
                    data-doc-id="${documentSnapshot.id}">
                    Delete
                </button>
            </div>

            <div class="conversation-answer">
                ${renderMarkdown(answerText)}
            </div>
        `;

        const deleteButton = item.querySelector(".delete-history-button");
        deleteButton.addEventListener("click", () => deleteHistoryEntry(user, documentSnapshot.id));

        historyList.appendChild(item);

        await renderMathJax(item);

        };

    }
    catch(error){

        console.error(error);

    }

}

async function handleSaveInteraction() {
    const user = auth.currentUser;
    if (!user) {
        alert("Please sign in.");
        return;
    }

    const prompt = toSafeText(promptInput.value);
    const answer = toSafeText(responseContainer.textContent || responseContainer.innerText || "");

    if (!prompt) {
        alert("Please enter a prompt before saving.");
        return;
    }

    if (!answer || answer === "Thinking..." || answer === "Something went wrong.") {
        alert("There is no response to save yet.");
        return;
    }

    saveButton.disabled = true;
    try {
        await saveConversationToFirestore(prompt, answer);
        alert("Conversation saved.");
        await loadHistory(user);
    } catch (error) {
        console.error("Save interaction error:", error);
        alert("Could not save the conversation.");
    } finally {
        saveButton.disabled = false;
    }
}

async function saveConversationToFirestore(prompt, answer) {

    const user = auth.currentUser;

    if (!user) return;

    try {

        await addDoc(

            collection(db, "users", user.uid, "history"),

            {
                prompt: toSafeText(prompt),
                answer: toSafeText(answer),
                createdAt: serverTimestamp()
            }

        );

    }

    catch (error) {

        console.error(error);

    }

}

async function deleteHistoryEntry(user, docId) {

    if (!user || !docId) return;

    try {

        await deleteDoc(doc(db, "users", user.uid, "history", docId));
        await loadHistory(user);

    } catch (error) {

        console.error("Delete history error:", error);
        alert("Could not delete this history item.");

    }

}

function setApplicationState(isLoggedIn) {

    promptInput.disabled = !isLoggedIn;
    askButton.disabled = !isLoggedIn;

    memoryInput.disabled = !isLoggedIn;
    conversationContextInput.disabled = !isLoggedIn;
    saveMemoryButton.disabled = !isLoggedIn;
    saveConversationContextButton.disabled = !isLoggedIn;
    saveButton.disabled = !isLoggedIn;
    refreshButton.disabled = !isLoggedIn;

    if (!isLoggedIn) {

        promptInput.value = "";
        memoryInput.value = "";
        conversationContextInput.value = "";

        promptInput.placeholder = "Sign in to chat with Friendly AI.";
        memoryInput.placeholder = "Sign in to use Memory.";
        conversationContextInput.placeholder = "Sign in to use conversation context.";
        userGreeting.textContent =
        "Please sign in to unlock personalized features.";

    } else {

        promptInput.placeholder = "Type your prompt here...";
        memoryInput.placeholder = "Edit the user summary or add preferences here...";
        conversationContextInput.placeholder = "Describe the current topic or goal of the conversation...";

    }

}

async function handleGoogleLogin() {

    try {

        const result = await signInWithPopup(auth, provider);

        console.log("Login successful");
        console.log(result.user);

    } catch (error) {

        console.error("Google Sign-In Error");
        console.error(error);

        alert(error.message);

    }

}

async function handleSignOut() {

    try {

        await signOut(auth);

        console.log("Signed out");

    } catch (error) {

        console.error(error);

    }

}

async function updateUserInterface(user) {

    if (user) {

        guestActions.hidden = true;
        userActions.hidden = false;

        username.textContent = user.displayName ?? "User";

        if (user.photoURL) {
            avatar.src = user.photoURL;
        } else {
            avatar.removeAttribute("src");
        }

        setApplicationState(true);        
        userGreeting.textContent = `Welcome back, ${user.displayName}!`;

        await loadMemory(user);
        await loadConversationContext(user);
        await loadHistory(user);

    } else {

        guestActions.hidden = false;
        userActions.hidden = true;

        historyList.innerHTML = "";
        responseContainer.innerHTML = "";

        username.textContent = "Username";

        avatar.removeAttribute("src");

        setApplicationState(false);

    }

}

function toggleTheme() {

    document.body.classList.toggle("dark-theme");

    const isDark = document.body.classList.contains("dark-theme");

    localStorage.setItem("theme", isDark ? "dark" : "light");

    themeToggleButton.textContent = isDark ? "☀️" : "🌙";

}
function loadTheme() {

    const savedTheme = localStorage.getItem("theme");

    if (savedTheme === "dark") {

        document.body.classList.add("dark-theme");

        themeToggleButton.textContent = "☀️";

    } else {

        document.body.classList.remove("dark-theme");

        themeToggleButton.textContent = "🌙";

    }

}

async function handlePromptSubmit(event) {

    event.preventDefault();

    const prompt = toSafeText(promptInput.value);

    if (prompt === "") {
        return;
    }

    if (!auth.currentUser) {
        responseContainer.textContent = "Please sign in to continue.";
        return;
    }

    responseContainer.textContent = "Thinking...";

    askButton.disabled = true;

    const displayName = getCurrentUserDisplayName();
    const userEmail = getCurrentUserEmail();

    try {

    const currentMemory = toSafeText(memoryInput.value);
    const currentConversationContext = toSafeText(conversationContextInput.value);
    const recentHistory = await buildRecentHistoryContext(auth.currentUser);
    const answer = await askAI(
        prompt,
        currentMemory,
        displayName,
        currentConversationContext,
        recentHistory,
        userEmail
    );

    const updatedMemory = await buildUpdatedMemory(currentMemory, prompt, answer, displayName, userEmail);
    memoryInput.value = updatedMemory;
    await persistMemory(updatedMemory, auth.currentUser);

    const updatedConversationContext = await buildUpdatedConversationContext(currentConversationContext, prompt, answer, displayName, userEmail);
    conversationContextInput.value = updatedConversationContext;
    await persistConversationContext(updatedConversationContext, auth.currentUser);

    await saveConversationToFirestore(prompt, answer);
    refreshButton.disabled = true;

    await loadHistory(auth.currentUser);

    refreshButton.disabled = false;

    responseContainer.innerHTML = renderMarkdown(toSafeText(answer));
    await renderMathJax(responseContainer);

    }
    catch(error){

    console.error(error);
    responseContainer.textContent = "Something went wrong.";

    }
    finally{

    askButton.disabled = false;
    promptInput.value = "";

    }
    console.log("Form submitted");

}

async function buildRecentHistoryContext(user) {

    if (!user) return "";

    try {

        const q = query(
            collection(db, "users", user.uid, "history"),
            orderBy("createdAt", "desc"),
            limit(5)
        );

        const snapshot = await getDocs(q);
        const recentItems = snapshot.docs.map((docSnapshot) => {
            const data = docSnapshot.data();
            return `User: ${String(data.prompt ?? "").replace(/\s+/g, " ").trim()}\nAssistant: ${String(data.answer ?? "").replace(/\s+/g, " ").trim()}`;
        });

        return recentItems.length > 0
            ? `Recent conversation history:\n${recentItems.join("\n\n")}`
            : "No recent history yet.";

    } catch (error) {

        console.error("History context load error:", error);
        return "";

    }

}

async function buildUpdatedConversationContext(existingContext, prompt, answer, displayName, userEmail = "") {

    const topic = String(prompt ?? "").replace(/\s+/g, " ").trim();
    const currentTopic = topic.length > 180 ? `${topic.slice(0, 180)}...` : topic;

    const summaryPrompt = `Create a concise topic summary for retrieval later.
    Write exactly 5 short sentences that summarize the main conversation topic and the key idea from the latest answer.
    Do not repeat the full answer or include long quotes.
    Keep it useful for helping the assistant find the right past conversation.

    Existing context:
    ${toSafeText(existingContext, "No prior context.")}

    Current topic:
    ${currentTopic}

    Latest answer focus:
    ${toSafeText(answer, "")}

    User name: ${displayName}`;

    const summary = await askAI(summaryPrompt, "", displayName, "", "", userEmail);
    const cleanedSummary = toSafeText(summary)
        .replace(/^Sure(?:,|:)?/i, "")
        .trim();

    return cleanedSummary.length > 3000 ? `${cleanedSummary.slice(0, 3000)}...` : cleanedSummary;

}

async function buildUpdatedMemory(existingMemory, prompt, answer, displayName, userEmail = "") {

    const summaryPrompt = `Create a brief user profile summary for future conversations.
    Extract only useful personal context, preferences, goals, or constraints.
    Keep it concise and helpful, ideally as 2-4 bullet points or one short paragraph.
    Avoid repeating the full conversation verbatim.
    Focus on what would help Friendly AI personalize future responses.

    Existing memory:
    ${toSafeText(existingMemory, "No prior memory.")}

    Latest interaction:
    User: ${toSafeText(prompt)}
    Assistant: ${toSafeText(answer)}

    User name: ${displayName}`;

    const summary = await askAI(summaryPrompt, existingMemory, displayName, "", "", userEmail);
    const cleanedSummary = toSafeText(summary)
        .replace(/^Sure(?:,|:)?/i, "")
        .trim();

    return cleanedSummary.length > 3000 ? `${cleanedSummary.slice(0, 3000)}...` : cleanedSummary;

}

async function persistMemory(text, user) {

    if (!user) return;

    const safeText = toSafeText(text);

    try {

        await setDoc(

            doc(db, "users", user.uid),

            {

                memory: {

                    text: safeText,

                    updatedAt: serverTimestamp()

                }

            },

            {

                merge: true

            }

        );

        currentMemoryText = safeText;

    }

    catch (error) {

        console.error("Memory save error:", error);
        throw error;

    }

}

async function persistConversationContext(text, user) {

    if (!user) return;

    const safeText = toSafeText(text);

    try {

        await setDoc(

            doc(db, "users", user.uid),

            {

                conversationContext: {

                    text: safeText,

                    updatedAt: serverTimestamp()

                }

            },

            {

                merge: true

            }

        );

        currentConversationContextText = safeText;

    }

    catch (error) {

        console.error("Conversation context save error:", error);
        throw error;

    }

}

async function saveMemory() {

    const user = auth.currentUser;

    if (!user) {

        alert("Please sign in.");
        return;

    }

    saveMemoryButton.disabled = true;

    try {

        await persistMemory(memoryInput.value, user);
        alert("Memory saved.");

    }

    catch (error) {

        console.error(error);

    }

    finally {

        saveMemoryButton.disabled = false;

    }

}

async function saveConversationContext() {

    const user = auth.currentUser;

    if (!user) {

        alert("Please sign in.");
        return;

    }

    saveConversationContextButton.disabled = true;

    try {

        await persistConversationContext(conversationContextInput.value, user);
        alert("Conversation context saved.");

    }

    catch (error) {

        console.error(error);

    }

    finally {

        saveConversationContextButton.disabled = false;

    }

}

async function loadMemory(user) {

    try {

        const snapshot = await getDoc(doc(db, "users", user.uid));

        if (!snapshot.exists()) {
            currentMemoryText = "";
            memoryInput.value = "";
            return;
        }

        const data = snapshot.data();
        const memoryText = toSafeText(data?.memory?.text, "");

        currentMemoryText = memoryText;
        memoryInput.value = memoryText;

    } catch (error) {

        console.error("Load Memory Error:", error);

    }

}

async function loadConversationContext(user) {

    try {

        const snapshot = await getDoc(doc(db, "users", user.uid));

        if (!snapshot.exists()) {
            currentConversationContextText = "";
            conversationContextInput.value = "";
            return;
        }

        const data = snapshot.data();
        const contextText = toSafeText(data?.conversationContext?.text, "");

        currentConversationContextText = contextText;
        conversationContextInput.value = contextText;

    } catch (error) {

        console.error("Load conversation context error:", error);

    }

}
