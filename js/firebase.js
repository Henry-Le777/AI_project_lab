
// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-analytics.js";
import {
    getAuth,
    GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

import {
    getFirestore
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
apiKey: "AIzaSyCYkVnwlFIn5hJaYLrOJaIyHmoLSoBK4rc",
authDomain: "friendly-ai-ad09f.firebaseapp.com",
projectId: "friendly-ai-ad09f",
storageBucket: "friendly-ai-ad09f.firebasestorage.app",
messagingSenderId: "294696455060",
appId: "1:294696455060:web:5d80c0ea3e7a8da5df1d81",
measurementId: "G-CT8WY557SK"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

const analytics = getAnalytics(app);

const auth = getAuth(app);

const provider = new GoogleAuthProvider();

const db = getFirestore(app);

export {
    auth,
    provider,
    db
};
