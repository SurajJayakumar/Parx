import "server-only";

import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";

let _db: Firestore | null = null;

export function getServerDb(): Firestore {
  if (_db) return _db;

  const app =
    getApps().length === 0
      ? initializeApp({
          apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
          authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
          storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
          messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
          appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
        })
      : getApp();

  _db = getFirestore(app);
  return _db;
}
