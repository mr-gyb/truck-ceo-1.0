import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase configuration - using direct values to avoid Vite env variable issues
const firebaseConfig = {
  apiKey: "AIzaSyAf60UgNSyncGk-6j55UXjZ1U54IxJpIQU",
  authDomain: "truck-ceo.firebaseapp.com",
  projectId: "truck-ceo",
  storageBucket: "truck-ceo.firebasestorage.app",
  messagingSenderId: "419699908912",
  appId: "1:419699908912:web:24d85875480487de03e8f5"
};

console.log('🔥 Firebase initialized with project:', firebaseConfig.projectId);

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
