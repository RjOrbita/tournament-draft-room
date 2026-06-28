// ============================================================
//  FIREBASE INITIALIZATION
//  Fill in your own Firebase project config below.
//  See README.md for setup instructions.
// ============================================================

const firebaseConfig = {
  apiKey:            "AIzaSyDmr0NGQ0EmF_NhUtYOHXc9hhFjEKSzvSo",
  authDomain:        "tournament-draft-room.firebaseapp.com",
  databaseURL:       "https://tournament-draft-room-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "tournament-draft-room",
  storageBucket:     "tournament-draft-room.firebasestorage.app",
  messagingSenderId: "989180926201",
  appId:             "1:989180926201:web:9ba7c7a21f30a5bfe96a28",
  measurementId:     "G-KFF7EKC9JS"
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
