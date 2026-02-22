"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getCaregiverSettings } from "@/lib/settingsStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Subset of MotionMetrics accepted by /api/sessions/ingest */
export interface AlertMetrics {
  walkingSpeed?: number;
  stepLength?: number;
  /** Average of armSwingL + armSwingR, if both present; otherwise whichever is set */
  armSwing?: number;
}

/** Raw metrics shape from CameraCapture (armSwing tracked per side) */
export interface RawMotionMetrics {
  walkingSpeed?: number;
  stepLength?: number;
  armSwingL?: number;
  armSwingR?: number;
  cadence?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How often (ms) to attempt a background ingest while the session is live */
const POLL_INTERVAL_MS = 30_000;

/** Minimum time (ms) between two consecutive ingest calls, regardless of trigger */
const CLIENT_COOLDOWN_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toAlertMetrics(raw: RawMotionMetrics): AlertMetrics {
  const { walkingSpeed, stepLength, armSwingL, armSwingR } = raw;
  let armSwing: number | undefined;
  if (armSwingL !== undefined && armSwingR !== undefined) {
    armSwing = (armSwingL + armSwingR) / 2;
  } else {
    armSwing = armSwingL ?? armSwingR;
  }
  return { walkingSpeed, stepLength, armSwing };
}

function hasAnyMetric(m: AlertMetrics): boolean {
  return (
    m.walkingSpeed !== undefined ||
    m.stepLength !== undefined ||
    m.armSwing !== undefined
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseSessionAlertOptions {
  /** Whether the camera session is currently active */
  sessionActive: boolean;
  /** Latest raw metrics from the motion pipeline */
  metrics: RawMotionMetrics;
  /** Fired when the ingest endpoint returns sent=true (email dispatched) */
  onAlerted?: () => void;
}

export function useSessionAlert({
  sessionActive,
  metrics,
  onAlerted,
}: UseSessionAlertOptions) {
  const lastSentRef = useRef<number>(0);
  const metricsRef = useRef<RawMotionMetrics>(metrics);
  const onAlertedRef = useRef(onAlerted);

  // Keep refs current without re-creating callbacks
  useEffect(() => { metricsRef.current = metrics; }, [metrics]);
  useEffect(() => { onAlertedRef.current = onAlerted; }, [onAlerted]);

  const [lastResult, setLastResult] = useState<{
    sent: boolean;
    severity?: string;
    riskScore?: number;
  } | null>(null);

  const maybeSendAlert = useCallback(async (trigger: "poll" | "sessionEnd") => {
    const now = Date.now();
    if (now - lastSentRef.current < CLIENT_COOLDOWN_MS) return;

    const { caregiverEmail, patientName, emailNotifications } =
      getCaregiverSettings();

    if (!caregiverEmail || !patientName) return;
    if (!emailNotifications) return;

    const alertMetrics = toAlertMetrics(metricsRef.current);

    // Don't bother calling the server if there is nothing to assess
    if (trigger !== "sessionEnd" && !hasAnyMetric(alertMetrics)) return;

    lastSentRef.current = now;

    try {
      const res = await fetch("/api/sessions/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caregiverEmail,
          patientName,
          metrics: alertMetrics,
          dashboardUrl: window.location.origin + "/dashboard",
        }),
      });

      if (!res.ok) return;

      const json = await res.json();
      setLastResult({
        sent: json.sent ?? false,
        severity: json.severity,
        riskScore: json.riskScore,
      });

      if (json.sent === true) {
        onAlertedRef.current?.();
      }
    } catch {
      // Silently ignore network errors — this is a background best-effort call
    }
  }, []);

  // Periodic poll while session is active
  useEffect(() => {
    if (!sessionActive) return;

    const id = setInterval(() => {
      maybeSendAlert("poll");
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [sessionActive, maybeSendAlert]);

  // Fire on session end
  const prevActiveRef = useRef(sessionActive);
  useEffect(() => {
    if (prevActiveRef.current && !sessionActive) {
      maybeSendAlert("sessionEnd");
    }
    prevActiveRef.current = sessionActive;
  }, [sessionActive, maybeSendAlert]);

  return { lastResult, maybeSendAlert };
}
