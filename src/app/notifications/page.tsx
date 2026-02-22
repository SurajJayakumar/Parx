"use client";

import { useEffect, useState } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/useAuth";
import AuthGate from "@/components/AuthGate";

interface NotificationDoc {
  id: string;
  type: string;
  sentTo: string;
  subject: string;
  status: "sent" | "failed" | "skipped" | string;
  severityScore?: number;
  meta?: Record<string, unknown>;
  createdAt: Timestamp | null;
}

function typeBadge(type: string): { label: string; classes: string } {
  const t = type.toLowerCase();
  if (t.includes("high") || t.includes("alert") || t.includes("risk")) {
    return {
      label: "High Risk",
      classes: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    };
  }
  if (t.includes("report") || t.includes("ready")) {
    return {
      label: "Report Ready",
      classes:
        "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    };
  }
  if (t.includes("week") || t.includes("summary")) {
    return {
      label: "Weekly",
      classes:
        "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
    };
  }
  // fallback — use the raw type value
  return {
    label: type,
    classes:
      "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  };
}

function formatTime(ts: Timestamp | null): string {
  if (!ts) return "";
  const date = ts.toDate();
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function NotificationList({ uid }: { uid: string }) {
  const [items, setItems] = useState<NotificationDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ref = collection(db, "users", uid, "notifications");
    const q = query(ref, orderBy("createdAt", "desc"), limit(50));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs: NotificationDoc[] = snap.docs.map((d) => ({
          id: d.id,
          type: d.data().type ?? "email",
          sentTo: d.data().sentTo ?? "",
          subject: d.data().subject ?? "",
          status: d.data().status ?? "sent",
          severityScore: d.data().severityScore,
          meta: d.data().meta,
          createdAt: d.data().createdAt ?? null,
        }));
        setItems(docs);
      },
      (err) => {
        console.error("[NotificationList] Firestore error:", err);
        setError("Could not load notifications.");
      },
    );

    return unsub;
  }, [uid]);

  // Loading skeleton
  if (items === null && error === null) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 rounded-xl bg-zinc-100 dark:bg-zinc-800 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-red-500 dark:text-red-400 text-center py-8">
        {error}
      </p>
    );
  }

  if (items!.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-zinc-400 dark:text-zinc-500">
        <svg
          className="h-10 w-10 opacity-40"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
        </svg>
        <p className="text-sm font-medium">No notifications yet</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {items!.map((n) => {
        const badge = typeBadge(n.type);
        const time = formatTime(n.createdAt);
        const failed = n.status === "failed";

        return (
          <li
            key={n.id}
            className="flex items-start gap-4 py-4 px-1 group"
          >
            {/* Type badge */}
            <span
              className={[
                "mt-0.5 shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide",
                badge.classes,
              ].join(" ")}
            >
              {badge.label}
            </span>

            {/* Subject + sentTo */}
            <div className="min-w-0 flex-1">
              <p
                className={[
                  "truncate text-sm font-medium",
                  failed
                    ? "text-red-500 dark:text-red-400"
                    : "text-zinc-900 dark:text-zinc-50",
                ].join(" ")}
              >
                {n.subject || "(no subject)"}
                {failed && (
                  <span className="ml-2 text-xs font-normal text-red-400 dark:text-red-500">
                    · failed
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                {n.sentTo}
              </p>
            </div>

            {/* Timestamp */}
            {time && (
              <time
                className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500 tabular-nums pt-0.5"
                dateTime={n.createdAt?.toDate().toISOString()}
              >
                {time}
              </time>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function NotificationsPage() {
  const { user } = useAuth();

  return (
    <AuthGate>
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 mb-6">
          Notifications
        </h1>

        {user && <NotificationList uid={user.uid} />}
      </div>
    </AuthGate>
  );
}