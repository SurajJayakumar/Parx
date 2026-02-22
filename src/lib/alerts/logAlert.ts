import "server-only";

import {
  collection,
  addDoc,
  serverTimestamp,
  type FieldValue,
} from "firebase/firestore";
import { getServerDb } from "@/lib/firebase/serverDb";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AlertLogEntry {
  uid: string;
  caregiverEmail: string;
  patientName: string;
  severityScore: number;
  severityLabel: string;
  reasons: string[];
  /** Client-supplied epoch ms; falls back to Firestore server time when absent. */
  createdAtMs?: number;
}

interface FirestoreDoc {
  uid: string;
  caregiverEmail: string;
  patientName: string;
  severityScore: number;
  severityLabel: string;
  reasons: string[];
  createdAtMs: number | FieldValue;
  createdAt: FieldValue;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Writes one alert-log document to `users/{uid}/alerts/{autoId}`.
 * Returns the new document id on success, or throws on failure.
 */
export async function logAlert(entry: AlertLogEntry): Promise<string> {
  const db = getServerDb();
  const col = collection(db, "users", entry.uid, "alerts");

  const doc: FirestoreDoc = {
    uid: entry.uid,
    caregiverEmail: entry.caregiverEmail,
    patientName: entry.patientName,
    severityScore: entry.severityScore,
    severityLabel: entry.severityLabel,
    reasons: entry.reasons,
    createdAtMs: entry.createdAtMs ?? serverTimestamp(),
    createdAt: serverTimestamp(),
  };

  const ref = await addDoc(col, doc);
  return ref.id;
}

/**
 * Best-effort wrapper — logs the alert and swallows any error.
 * Use this when a logging failure must not block the primary request.
 */
export async function logAlertBestEffort(entry: AlertLogEntry): Promise<void> {
  try {
    await logAlert(entry);
  } catch {
    // Intentionally silent — alert logging is non-critical
  }
}
