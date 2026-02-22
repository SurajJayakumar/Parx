"use client";

import { useState, useCallback, useEffect } from "react";
import AuthGate from "@/components/AuthGate";
import CameraCapture, { MotionMetrics } from "@/components/CameraCapture";
import { useSessionAlert } from "@/lib/alerts/useSessionAlert";

export default function CameraPage() {
  const [sessionActive, setSessionActive] = useState(false);
  const [latestMetrics, setLatestMetrics] = useState<MotionMetrics>({});
  const [alertedToast, setAlertedToast] = useState(false);

  const handleAlerted = useCallback(() => setAlertedToast(true), []);

  const { lastResult } = useSessionAlert({
    sessionActive,
    metrics: latestMetrics,
    onAlerted: handleAlerted,
  });

  // Auto-dismiss the "Caregiver alerted" toast after 4 s
  useEffect(() => {
    if (!alertedToast) return;
    const id = setTimeout(() => setAlertedToast(false), 4000);
    return () => clearTimeout(id);
  }, [alertedToast]);

  const handleMetricsSnapshot = useCallback((m: MotionMetrics) => {
    setLatestMetrics(m);
    // A metrics update implies the session is live
    setSessionActive(true);
  }, []);

  const handleSessionEnd = useCallback((m: MotionMetrics) => {
    setLatestMetrics(m);
    setSessionActive(false);
  }, []);

  return (
    <AuthGate>
      <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 mb-1">
        Live Camera
      </h1>
      <p className="text-zinc-500 dark:text-zinc-400 mb-8 text-sm">
        Real-time movement capture for motor analysis.
      </p>

      <CameraCapture
        onMetricsSnapshot={handleMetricsSnapshot}
        onSessionEnd={handleSessionEnd}
      />

      {/* Debug info — last ingest result, shown only in development */}
      {process.env.NODE_ENV === "development" && lastResult && (
        <p className="mt-4 text-center text-xs text-zinc-400">
          Last ingest: severity={lastResult.severity ?? "—"} score=
          {lastResult.riskScore ?? "—"} sent={String(lastResult.sent)}
        </p>
      )}

      <p className="mt-8 text-center text-xs text-zinc-400 dark:text-zinc-500">
        Screening tool — not a medical diagnosis.
      </p>

      {/* "Caregiver alerted" toast — silent unless sent=true */}
      <div
        aria-live="assertive"
        aria-atomic="true"
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
      >
        <div
          className={`flex items-center gap-2.5 rounded-2xl bg-zinc-900 dark:bg-zinc-50 px-5 py-3 text-sm font-medium text-white dark:text-zinc-900 shadow-lg transition-all duration-300 ${
            alertedToast
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-3"
          }`}
        >
          <svg
            className="h-4 w-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
            />
          </svg>
          Caregiver alerted
        </div>
      </div>
    </AuthGate>
  );
}
