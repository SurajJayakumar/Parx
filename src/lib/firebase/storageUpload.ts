import "server-only";

/**
 * Uploads a PDF to Firebase Storage via the Firebase Storage REST API and
 * returns the public download URL.
 *
 * Firebase Storage REST API reference:
 *   POST https://firebasestorage.googleapis.com/v0/b/{bucket}/o?name={path}
 *
 * The bucket name is the full value from NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
 * e.g. "parkinsonai-53f04.firebasestorage.app".  It must be passed raw (not
 * percent-encoded) in the path segment — Firebase's own SDK does not encode it.
 *
 * Storage rule needed (rules version 2):
 *   match /reports/{allPaths=**} { allow read, write: if true; }
 */

const STORAGE_BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

export async function uploadPdfToStorage(
  bytes: Uint8Array<ArrayBuffer>,
  storagePath: string, // e.g. "reports/uid/filename.pdf"
): Promise<string> {
  if (!STORAGE_BUCKET || !API_KEY) {
    throw new Error("Firebase Storage bucket or API key is not configured.");
  }

  // Firebase Storage REST API: name param is the object path, percent-encoded.
  // The bucket segment in the URL path must NOT be encoded — pass it raw.
  const encodedPath = encodeURIComponent(storagePath);

  const uploadUrl =
    `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o` +
    `?name=${encodedPath}&key=${API_KEY}`;

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: bytes,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[storageUpload] Failed URL:", uploadUrl.replace(API_KEY, "***"));
    throw new Error(`Storage upload failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { name?: string; downloadTokens?: string };

  // Build the permanent public download URL with the Firebase media token
  const token = json.downloadTokens ?? "";
  const publicUrl =
    `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/` +
    `${encodedPath}?alt=media&token=${token}`;

  return publicUrl;
}
