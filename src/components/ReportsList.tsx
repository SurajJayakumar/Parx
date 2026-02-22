"use client";

import { useEffect, useState } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { ensureUser } from "@/lib/firebase/auth";
import { useAuth } from "@/lib/useAuth";
import EmptyState from "@/components/EmptyState";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SeverityLevel = "low" | "medium" | "high";

interface Report {
  id: string;
  title: string;
  createdAt: Date;
  highestSeverity: SeverityLevel;
  summary: string;
  observations: string[];
  interpretation: string;
  nextSteps: string[];
  safetyNotes: string[];
  disclaimer: string;
  pdfUrl: string;
}

// ---------------------------------------------------------------------------
// Severity — badge colour driven by numeric score (0–10 scale inferred from
// the string value stored in Firestore: low=0–3, medium=4–6, high=7+)
// ---------------------------------------------------------------------------

const SEVERITY_META: Record<
  SeverityLevel,
  { label: string; dot: string; badge: string }
> = {
  low: {
    label: "Low",
    dot: "bg-emerald-500",
    badge:
      "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:ring-emerald-800",
  },
  medium: {
    label: "Medium",
    dot: "bg-amber-500",
    badge:
      "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:ring-amber-800",
  },
  high: {
    label: "High",
    dot: "bg-red-500",
    badge:
      "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-900/30 dark:text-red-400 dark:ring-red-800",
  },
};

function normaliseSeverity(raw: unknown): SeverityLevel {
  if (raw === "medium" || raw === "high") return raw;
  return "low";
}

function formatDateTime(date: Date): string {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ---------------------------------------------------------------------------
// Collapse threshold
// ---------------------------------------------------------------------------

const COLLAPSE_CHARS = 300;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SeverityBadge({ level }: { level: SeverityLevel }) {
  const meta = SEVERITY_META[level];
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        meta.badge,
      ].join(" ")}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
      {meta.label} Severity
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-5 text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
      {children}
    </p>
  );
}

/** Paragraph that collapses when text exceeds COLLAPSE_CHARS */
function CollapsibleText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  // Extract key-value pairs from JSON-like string using regex
  const pairs: { key: string; value: string | string[] }[] = [];
  const kvRegex = /"(\w+)"\s*:\s*(\[[\s\S]*?\]|"(?:[^"\\]|\\.)*")/g;
  let match;
  while ((match = kvRegex.exec(text)) !== null) {
    const key = match[1];
    const raw = match[2].trim();
    if (raw.startsWith("[")) {
      // Array: extract quoted strings inside brackets
      const items: string[] = [];
      const itemRegex = /"((?:[^"\\]|\\.)*)"/g;
      let m;
      while ((m = itemRegex.exec(raw)) !== null) items.push(m[1]);
      pairs.push({ key, value: items });
    } else {
      pairs.push({ key, value: raw.replace(/^"|"$/g, "") });
    }
  }

  const isJson = pairs.length > 0;

  if (isJson) {
    const formatKey = (k: string) =>
      k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    const visiblePairs = expanded ? pairs : pairs.slice(0, 2);
    const long = pairs.length > 2;

    return (
      <div className="mt-1.5 space-y-3">
        {visiblePairs.map(({ key, value }) => (
          <div key={key}>
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {formatKey(key)}
            </p>
            {Array.isArray(value) ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {value.map((item, i) => (
                  <li key={i} className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-0.5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                {value}
              </p>
            )}
          </div>
        ))}
        {long && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline focus:outline-none"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
    );
  }

  // Fallback: plain text with original collapse behaviour
  const long = text.length > COLLAPSE_CHARS;
  const displayed = long && !expanded ? text.slice(0, COLLAPSE_CHARS).trimEnd() + "…" : text;

  return (
    <div>
      <p className="mt-1.5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        {displayed}
      </p>
      {long && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline focus:outline-none"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/** Bullet list that collapses when the joined text exceeds COLLAPSE_CHARS */
function CollapsibleBulletList({ items }: { items: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const joined = items.join(" ");
  const long = joined.length > COLLAPSE_CHARS;

  // Decide how many items to show when collapsed by accumulating chars
  let visibleCount = items.length;
  if (long && !expanded) {
    let chars = 0;
    visibleCount = 0;
    for (const item of items) {
      chars += item.length;
      visibleCount += 1;
      if (chars >= COLLAPSE_CHARS) break;
    }
  }

  const visible = items.slice(0, visibleCount);

  return (
    <div>
      <ul className="mt-1.5 space-y-1.5 pl-0">
        {visible.map((item, i) => (
          <li key={i} className="flex gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
            <span
              className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600"
              aria-hidden="true"
            />
            <span className="leading-relaxed">{item}</span>
          </li>
        ))}
      </ul>
      {long && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline focus:outline-none"
        >
          {expanded ? "Show less" : `Show ${items.length - visibleCount} more`}
        </button>
      )}
    </div>
  );
}

const ExternalLinkIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    className="h-3.5 w-3.5 shrink-0"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
    />
  </svg>
);

function ReportCard({ report }: { report: Report }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article className="rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
      {/* Severity accent stripe */}
      <div
        className={[
          "h-1 w-full",
          report.highestSeverity === "high"
            ? "bg-red-500"
            : report.highestSeverity === "medium"
              ? "bg-amber-400"
              : "bg-emerald-500",
        ].join(" ")}
        aria-hidden="true"
      />

      <div className="p-5">
        {/* Header — always visible */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 leading-snug">
              {report.title}
            </h3>
            <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
              {formatDateTime(report.createdAt)}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <SeverityBadge level={report.highestSeverity} />
            {report.pdfUrl ? (
              <a
                href={report.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700/70 transition-colors"
              >
                <ExternalLinkIcon />
                Open PDF
              </a>
            ) : null}
          </div>
        </div>

        {/* Expanded body */}
        {expanded && (
          <>
            {/* Divider */}
            <div className="mt-4 border-t border-zinc-100 dark:border-zinc-800" />

            {/* Summary */}
            {report.summary ? (
              <>
                <SectionLabel>Summary</SectionLabel>
                <CollapsibleText text={report.summary} />
              </>
            ) : null}

            {/* Key Observations */}
            {report.observations.length > 0 ? (
              <>
                <SectionLabel>Key Observations</SectionLabel>
                <CollapsibleBulletList items={report.observations} />
              </>
            ) : null}

            {/* Interpretation */}
            {report.interpretation ? (
              <>
                <SectionLabel>Interpretation</SectionLabel>
                <CollapsibleText text={report.interpretation} />
              </>
            ) : null}

            {/* Next Steps */}
            {report.nextSteps.length > 0 ? (
              <>
                <SectionLabel>Next Steps</SectionLabel>
                <CollapsibleBulletList items={report.nextSteps} />
              </>
            ) : null}

            {/* Safety Notes */}
            {report.safetyNotes.length > 0 ? (
              <>
                <SectionLabel>Safety Notes</SectionLabel>
                <CollapsibleBulletList items={report.safetyNotes} />
              </>
            ) : null}

            {/* Disclaimer */}
            {report.disclaimer ? (
              <p className="mt-5 border-t border-zinc-100 dark:border-zinc-800 pt-3 text-[11px] italic leading-relaxed text-zinc-400 dark:text-zinc-500">
                {report.disclaimer}
              </p>
            ) : null}
          </>
        )}

        {/* Show more / Show less toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline focus:outline-none"
        >
          {expanded ? (
            <>
              Show less
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
              </svg>
            </>
          ) : (
            <>
              Show more
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </>
          )}
        </button>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ReportsList() {
  const { user } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function clearHistory() {
    const resolvedUser = user ?? (await ensureUser());
    setClearing(true);
    try {
      const res = await fetch(`/api/reports/clear?uid=${resolvedUser.uid}`, { method: "DELETE" });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Clear failed.");
      setReports([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear reports.");
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function fetchReports() {
      try {
        const resolvedUser = user ?? (await ensureUser());

        const q = query(
          collection(db, "users", resolvedUser.uid, "reports"),
          orderBy("createdAt", "desc"),
          limit(20),
        );
        const snap = await getDocs(q);
        if (cancelled) return;

        const fetched: Report[] = snap.docs.map((doc) => {
          const d = doc.data();
          const ts = d.createdAt as Timestamp | null;
          return {
            id: doc.id,
            title: (d.title as string | undefined) ?? `Report ${doc.id}`,
            createdAt: ts ? ts.toDate() : new Date(0),
            highestSeverity: normaliseSeverity(d.highestSeverity),
            summary: (d.summary as string | undefined) ?? "",
            observations: Array.isArray(d.observations) ? (d.observations as string[]) : [],
            interpretation: (d.interpretation as string | undefined) ?? "",
            nextSteps: Array.isArray(d.nextSteps) ? (d.nextSteps as string[]) : [],
            safetyNotes: Array.isArray(d.safetyNotes) ? (d.safetyNotes as string[]) : [],
            disclaimer: (d.disclaimer as string | undefined) ?? "",
            pdfUrl: (d.pdfUrl as string | undefined) ?? "",
          };
        });

        setReports(fetched);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load reports.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchReports();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-14">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-800 dark:border-zinc-700 dark:border-t-zinc-100" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <EmptyState
          title="Could not load reports"
          description={error}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          }
        />
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <EmptyState
          title="No reports yet"
          description="PDF reports will appear here after you complete a mobility session."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          {reports.length} report{reports.length !== 1 ? "s" : ""}
        </p>
        <button
          onClick={() => setConfirmClear(true)}
          disabled={clearing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-red-50 hover:border-red-200 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:border-red-900 dark:hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-3.5 w-3.5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
          Clear history
        </button>
      </div>

      {/* Confirmation dialog */}
      {confirmClear && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4">
          <p className="text-sm font-medium text-red-800 dark:text-red-300">
            Delete all {reports.length} report{reports.length !== 1 ? "s" : ""}?
          </p>
          <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">
            This permanently removes all report records. PDF files already downloaded are not affected.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={clearHistory}
              disabled={clearing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {clearing ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border border-white/40 border-t-white" />
                  Deleting…
                </>
              ) : (
                "Yes, delete all"
              )}
            </button>
            <button
              onClick={() => setConfirmClear(false)}
              disabled={clearing}
              className="rounded-lg border border-red-200 dark:border-red-800 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {reports.map((report) => (
        <ReportCard key={report.id} report={report} />
      ))}
    </div>
  );
}
