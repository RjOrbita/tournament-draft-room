// ============================================================
//  FIREBASE INITIALIZATION — TEMPLATE
//  Copy this file to js/firebase-init.js and fill in your values.
//  js/firebase-init.js is in .gitignore so your keys stay private.
// ============================================================
//
//  HOW TO GET THESE VALUES:
//  1. Go to https://console.firebase.google.com
//  2. Select your project → ⚙️ Project Settings → Your apps → Web app
//  3. Copy the firebaseConfig object shown there
//
// ============================================================

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT_ID-default-rtdb.REGION.firebasedatabase.app",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
  measurementId:     "YOUR_MEASUREMENT_ID"   // optional
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

const db   = firebase.database();
const auth = firebase.auth();

// ============================================================
//  Session helpers
// ============================================================
const SESSION_KEY = 'tdr_session';

function saveSession(data) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch(e) {}
}

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch(e) { return null; }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch(e) {}
}

// ============================================================
//  Sign in anonymously (stable UID across refreshes via IndexedDB)
// ============================================================
async function ensureAuth() {
  return new Promise((resolve, reject) => {
    const unsub = auth.onAuthStateChanged(user => {
      unsub();
      if (user) { resolve(user); }
      else {
        auth.signInAnonymously()
          .then(cred => resolve(cred.user))
          .catch(reject);
      }
    });
  });
}
