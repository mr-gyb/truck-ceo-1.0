/// <reference types="vite/client" />
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase config comes from environment variables (Vite: import.meta.env).
// These are the public web-client values (safe to bake into the client
// bundle); the API key itself is locked down by HTTP-referrer restrictions in
// Google Cloud Console. Never commit a .env file — it is gitignored.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  throw new Error(
    'Missing Firebase configuration: set VITE_FIREBASE_* variables in .env ' +
      '(see FIREBASE_FIX/.env.example).'
  );
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);

console.log('Firebase initialized with project:', firebaseConfig.projectId);

// Export Firebase services (always defined — module throws above when unconfigured)
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
