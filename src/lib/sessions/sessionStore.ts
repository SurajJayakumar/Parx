import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDocs,
  getDoc,
  writeBatch,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionEventType = "symptom" | "fall";
export type SessionSeverity = "low" | "medium" | "high";

export interface SessionEvent {
  id: string;
  type: SessionEventType;
  severity: SessionSeverity;
  fallDetected: boolean;
  pdProbability: number;
  fallProbability: number;
  centralDate: string;
  centralTime: string;
  isoTimestamp: string;
  createdAt?: Timestamp;
}

// ---------------------------------------------------------------------------
// Date-key helpers (date-local, stable across refresh for the same calendar day)
// ---------------------------------------------------------------------------

const CENTRAL_TZ = "America/Chicago";

function todaySessionId(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CENTRAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// ---------------------------------------------------------------------------
// Firestore paths
//   users/{uid}/sessions/{sessionId}           – session metadata doc
//   users/{uid}/sessions/{sessionId}/events/{} – individual event docs
// ---------------------------------------------------------------------------

function sessionRef(uid: string, sessionId: string) {
  return doc(db, "users", uid, "sessions", sessionId);
}

function eventsCol(uid: string, sessionId: string) {
  return collection(db, "users", uid, "sessions", sessionId, "events");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns today's date-keyed session ID and ensures the session doc exists. */
export async function getOrCreateTodaySession(uid: string): Promise<string> {
  const sessionId = todaySessionId();
  const ref = sessionRef(uid, sessionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      createdAt: serverTimestamp(),
      date: sessionId,
    });
  }
  return sessionId;
}

/** Appends one event document to the session's events subcollection. */
export async function appendSessionEvent(
  uid: string,
  sessionId: string,
  event: Omit<SessionEvent, "id" | "createdAt">,
): Promise<void> {
  await addDoc(eventsCol(uid, sessionId), {
    ...event,
    createdAt: serverTimestamp(),
  });
}

/** Loads all events for a session, ordered oldest-first. */
export async function loadSessionEvents(
  uid: string,
  sessionId: string,
): Promise<SessionEvent[]> {
  const q = query(eventsCol(uid, sessionId), orderBy("createdAt", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<SessionEvent, "id">),
  }));
}

/**
 * Deletes all events in a session's events subcollection.
 * Uses batched deletes (Firestore limit: 500 per batch).
 */
export async function clearSessionEvents(
  uid: string,
  sessionId: string,
): Promise<void> {
  const col = eventsCol(uid, sessionId);
  const snap = await getDocs(col);
  if (snap.empty) return;

  const BATCH_SIZE = 500;
  for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

/**
 * Subscribes to the latest 50 events for a session, ordered newest-first.
 * Calls `onEvents` immediately with the current snapshot and on every change.
 * Returns an unsubscribe function — call it to stop listening.
 */
export function subscribeSessionEvents(
  uid: string,
  sessionId: string,
  onEvents: (events: SessionEvent[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    eventsCol(uid, sessionId),
    orderBy("createdAt", "desc"),
    limit(50),
  );

  return onSnapshot(
    q,
    (snap) => {
      const events = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<SessionEvent, "id">),
      }));
      onEvents(events);
    },
    (err) => onError?.(err),
  );
}
