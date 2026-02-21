import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";

const REQUIRED_ENV_VARS = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
} as const;

const missing = Object.entries(REQUIRED_ENV_VARS)
  .filter(([, value]) => !value)
  .map(([key]) => `NEXT_PUBLIC_FIREBASE_${key.replace(/([A-Z])/g, "_$1").toUpperCase()}`);

if (missing.length > 0) {
  throw new Error(
    `Missing required Firebase environment variables:\n  ${missing.join("\n  ")}\n` +
      "Add them to your .env.local file."
  );
}

const firebaseConfig = {
  ...(REQUIRED_ENV_VARS as Record<string, string>),
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const app: FirebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export { app };
export const auth = getAuth(app);

// Analytics is browser-only; isSupported() returns false in SSR/Node environments.
export let analytics: Analytics | null = null;
if (typeof window !== "undefined") {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  });
}
