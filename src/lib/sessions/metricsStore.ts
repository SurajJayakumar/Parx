import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
  type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetricSnapshot {
  stepLength?: number;
  armSwingL?: number;
  armSwingR?: number;
  walkingSpeed?: number;
  ts: number; // performance.now()-relative ms offset from session start, stored as epoch ms
  createdAt?: Timestamp;
}

// ---------------------------------------------------------------------------
// Firestore paths
//   users/{uid}/sessions/{sessionId}/metrics/{auto-id}
// ---------------------------------------------------------------------------

function metricsCol(uid: string, sessionId: string) {
  return collection(db, "users", uid, "sessions", sessionId, "metrics");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Appends one metric snapshot to the session's metrics subcollection. */
export async function appendMetricSnapshot(
  uid: string,
  sessionId: string,
  snapshot: Omit<MetricSnapshot, "createdAt">,
): Promise<void> {
  await addDoc(metricsCol(uid, sessionId), {
    ...snapshot,
    createdAt: serverTimestamp(),
  });
}

/**
 * Loads up to `maxPoints` metric snapshots for a session, ordered oldest-first.
 * Defaults to 300 points (≈ 75 seconds at 4 writes/s, or 5 min at 1/s).
 */
export async function loadMetricSnapshots(
  uid: string,
  sessionId: string,
  maxPoints = 300,
): Promise<MetricSnapshot[]> {
  const q = query(
    metricsCol(uid, sessionId),
    orderBy("createdAt", "asc"),
    limit(maxPoints),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as MetricSnapshot);
}
