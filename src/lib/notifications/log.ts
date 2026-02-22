import "server-only";

import {
  collection,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { getServerDb } from "@/lib/firebase/serverDb";

export type NotificationStatus = "sent" | "failed" | "skipped";
export type NotificationType = "email" | "sms" | "push" | string;

interface LogNotificationParams {
  uid: string;
  type: NotificationType;
  sentTo: string;
  subject: string;
  status: NotificationStatus;
  severityScore?: number;
  meta?: Record<string, unknown>;
}

export async function logNotification({
  uid,
  type,
  sentTo,
  subject,
  status,
  severityScore,
  meta,
}: LogNotificationParams): Promise<void> {
  try {
    const db = getServerDb();
    const ref = collection(db, "users", uid, "notifications");

    const doc: Record<string, unknown> = {
      type,
      sentTo,
      subject,
      status,
      createdAt: serverTimestamp(),
    };

    if (severityScore !== undefined) doc.severityScore = severityScore;
    if (meta !== undefined) doc.meta = meta;

    await addDoc(ref, doc);
  } catch (err) {
    console.error("[logNotification] Failed to write notification log:", err);
  }
}
