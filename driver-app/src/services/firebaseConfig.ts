/// <reference types="vite/client" />
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

// Same pattern as the TruckCEO owner app: config comes from VITE_FIREBASE_*
// env vars (public web-client values; never commit a .env file). Unlike the
// owner app, this module does NOT throw when unconfigured — a rough draft
// must still load and say honestly that it is not connected yet.

// Same-domain auth handler: when this app is served from a Firebase Hosting
// domain, point authDomain at the current hostname instead of the default
// *.firebaseapp.com value. Firebase serves the __/auth/handler page from the
// hosting domain too, so the sign-in redirect stays same-site and its
// sessionStorage state survives the round-trip. With the firebaseapp.com
// handler, cross-site storage partitioning (notably iOS in-app browsers)
// wipes that state and sign-in dies with "Unable to process request due to
// missing initial state". On any other host (localhost dev) keep the
// env-provided authDomain.
const isFirebaseHostingDomain = (hostname: string) =>
  hostname === 'truck-ceo.web.app' ||
  hostname === 'app.truckceos.com' ||
  hostname.endsWith('.web.app');

const effectiveAuthDomain =
  typeof window !== 'undefined' && isFirebaseHostingDomain(window.location.hostname)
    ? window.location.hostname
    : (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined);

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: effectiveAuthDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;
let storageInstance: FirebaseStorage | null = null;

if (firebaseConfigured) {
  app = initializeApp(firebaseConfig);
  authInstance = getAuth(app);
  dbInstance = getFirestore(app);
  storageInstance = getStorage(app);
}

export const auth = authInstance;
export const db = dbInstance;
export const storage = storageInstance;
