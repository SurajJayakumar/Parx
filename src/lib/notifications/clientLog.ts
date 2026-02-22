import { collection, addDoc, serverTimestamp } from "firebase/firestore";

import { db } from "@/lib/firebase/client";
import { ensureUser } from "@/lib/firebase/auth";
import type { NotificationStatus, NotificationType } from "./log";

interface LogNotificationClientParams {
  type: NotificationType;
  subject: string;
  sentTo: string;
  status: NotificationStatus;
  severityScore?: number;
  severityLabel?: string;
  meta?: Record<string, unknown>;
}

export async function logNotificationClient(
  payload: LogNotificationClientParams
): Promise<void> {
  const { uid } = await ensureUser();

  const doc: Record<string, unknown> = {
    type: payload.type,
    subject: payload.subject,
    sentTo: payload.sentTo,
    status: payload.status,
    createdAt: serverTimestamp(),
    read: false,
  };

  if (payload.severityScore !== undefined) doc.severityScore = payload.severityScore;
  if (payload.severityLabel !== undefined) doc.severityLabel = payload.severityLabel;
  if (payload.meta !== undefined) doc.meta = payload.meta;

  await addDoc(collection(db, "users", uid, "notifications"), doc);
}
