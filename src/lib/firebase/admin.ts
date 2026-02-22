import "server-only";

// ---------------------------------------------------------------------------
// Firebase Admin SDK — server-only singleton
//
// Required environment variables (set in .env.local for local dev, or in your
// hosting provider's secret/environment config for production):
//
//   FIREBASE_PROJECT_ID=parkinsonai-53f04
//     Your Firebase project ID (same value as NEXT_PUBLIC_FIREBASE_PROJECT_ID,
//     but kept private so it is never bundled into client-side code).
//
//   FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@<project>.iam.gserviceaccount.com
//     The service-account email from your downloaded service-account JSON key.
//
//   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
//     The RSA private key from the service-account JSON.
//     ⚠ The value must be wrapped in double-quotes in .env.local so that the
//       shell does not strip the surrounding quotes and the literal \n sequences
//       are preserved as-is.  The code below converts them to real newlines.
//     ⚠ In Vercel / Railway / Render: paste the raw multi-line key directly
//       into the secret field — those platforms handle newlines natively, so
//       you do NOT need the quotes and do NOT need literal \n sequences.
//
// Optional environment variable:
//
//   FIREBASE_STORAGE_BUCKET=parxx.appspot.com
//     Overrides the Storage bucket used by adminStorage.  Useful when your
//     Admin SDK bucket name differs from NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
//     (e.g. legacy projects that still use the <project>.appspot.com bucket).
//     Falls back to NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET when omitted.
// ---------------------------------------------------------------------------

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

// ---------------------------------------------------------------------------
// Credential detection
// ---------------------------------------------------------------------------

// True when all three required env vars are present.  The route layer checks
// this flag to decide between the server-upload path and the client-upload
// fallback — no credentials means no server-side Storage or signed URLs.
export const hasAdminCredentials =
  Boolean(process.env.FIREBASE_PROJECT_ID) &&
  Boolean(process.env.FIREBASE_CLIENT_EMAIL) &&
  Boolean(process.env.FIREBASE_PRIVATE_KEY);

// ---------------------------------------------------------------------------
// Lazy singleton — only initialised when credentials are present
// ---------------------------------------------------------------------------

function getAdminApp() {
  // Avoid re-initialising on hot-reload (Next.js dev server) or in
  // environments that import this module more than once.
  if (getApps().length > 0) {
    return getApps()[0]!;
  }

  if (!hasAdminCredentials) {
    throw new Error(
      "Firebase Admin credentials are not configured. " +
        "Check FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY."
    );
  }

  // .env.local stores the key with literal \n sequences (required when the
  // value is quoted).  Replace them with real newlines before passing to the
  // SDK — otherwise the PEM parser will reject the key.
  const privateKey = process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n");

  // Prefer the server-only FIREBASE_STORAGE_BUCKET override; fall back to the
  // public client-side bucket variable so no extra config is needed in the
  // common case.
  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET ??
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID!,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
      privateKey,
    }),
    storageBucket,
  });
}

// adminDb / adminStorage intentionally NOT exported as constants at module
// level — they would throw at import time when credentials are absent.
// Instead, call these getters after checking hasAdminCredentials.

export function getAdminDb() {
  return getFirestore(getAdminApp());
}

export function getAdminStorage() {
  // Pass the bucket name explicitly when FIREBASE_STORAGE_BUCKET is set so
  // that bucket() uses the correct bucket rather than the SDK default.
  const bucketName =
    process.env.FIREBASE_STORAGE_BUCKET ??
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  return getStorage(getAdminApp()).bucket(bucketName);
}

// Convenience re-exports for callers that guard with hasAdminCredentials first.
export const adminDb = hasAdminCredentials ? getAdminDb() : null;
export const adminStorage = hasAdminCredentials ? getAdminStorage() : null;
