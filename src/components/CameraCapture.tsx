"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Card, CardSectionLabel } from "@/components/ui/Card";

type CameraState = "idle" | "active" | "error";

export interface MotionMetrics {
  walkingSpeed?: number;
  cadence?: number;
  stepLength?: number;
  armSwingL?: number;
  armSwingR?: number;
}

interface CameraCaptureProps {
  /** Called each time the metrics snapshot changes while the camera is active */
  onMetricsSnapshot?: (metrics: MotionMetrics) => void;
  /** Called when the camera stream is stopped */
  onSessionEnd?: (metrics: MotionMetrics) => void;
}

const METRIC_DEFS: {
  key: keyof MotionMetrics;
  label: string;
  unit: string;
  icon: React.ReactNode;
}[] = [
  {
    key: "walkingSpeed",
    label: "Walking Speed",
    unit: "m/s",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5l7.5-7.5 6 6L21 6" />
      </svg>
    ),
  },
  {
    key: "cadence",
    label: "Step Cadence",
    unit: "steps/min",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    key: "stepLength",
    label: "Step Length",
    unit: "cm",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
  },
  {
    key: "armSwingL",
    label: "Arm Swing (L)",
    unit: "°",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
      </svg>
    ),
  },
  {
    key: "armSwingR",
    label: "Arm Swing (R)",
    unit: "°",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15l4.875-4.875L18 15M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
      </svg>
    ),
  },
];

const CAMERA_ERRORS: Record<string, string> = {
  NotAllowedError: "Camera permission was denied. Please allow access in your browser settings and try again.",
  NotFoundError: "No camera was found on this device.",
  NotReadableError: "The camera is already in use by another application.",
  OverconstrainedError: "No camera matched the requested configuration.",
};

function getErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    return CAMERA_ERRORS[err.name] ?? `Camera error: ${err.message}`;
  }
  return "An unexpected error occurred while accessing the camera.";
}

export default function CameraCapture({
  onMetricsSnapshot,
  onSessionEnd,
}: CameraCaptureProps = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  // Metrics are undefined until MediaPipe populates them.
  const [metrics] = useState<MotionMetrics>({});

  // Keep callback refs stable so interval/cleanup closures always see latest
  const onMetricsSnapshotRef = useRef(onMetricsSnapshot);
  const onSessionEndRef = useRef(onSessionEnd);
  useEffect(() => { onMetricsSnapshotRef.current = onMetricsSnapshot; }, [onMetricsSnapshot]);
  useEffect(() => { onSessionEndRef.current = onSessionEnd; }, [onSessionEnd]);

  // Notify parent whenever metrics change while active
  useEffect(() => {
    if (cameraState === "active") {
      onMetricsSnapshotRef.current?.(metrics);
    }
  }, [metrics, cameraState]);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    onSessionEndRef.current?.(metrics);
    setCameraState("idle");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startStream = useCallback(async () => {
    setErrorMessage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraState("active");
    } catch (err) {
      setErrorMessage(getErrorMessage(err));
      setCameraState("error");
    }
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="flex flex-col items-center w-full gap-4">
      {/* Video element — always mounted so the ref is always available */}
      <div className="relative w-full overflow-hidden rounded-2xl bg-zinc-900 aspect-video">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover transition-opacity duration-300 ${
            cameraState === "active" ? "opacity-100" : "opacity-0"
          }`}
          aria-label="Live camera feed"
        />

        {/* Idle overlay */}
        {cameraState === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-zinc-400">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-800">
              <svg
                className="h-8 w-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-zinc-300">Camera preview will appear here</p>
            <p className="text-xs text-zinc-500">Press Start to connect your webcam</p>
          </div>
        )}

        {/* Error overlay */}
        {cameraState === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-900/40">
              <svg
                className="h-7 w-7 text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
            </div>
            <p className="text-sm font-semibold text-red-400">Camera unavailable</p>
            <p className="max-w-xs text-xs leading-relaxed text-zinc-400">{errorMessage}</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex gap-3">
        {cameraState !== "active" ? (
          <button
            onClick={startStream}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7L8 5z" />
            </svg>
            Start
          </button>
        ) : (
          <button
            onClick={stopStream}
            className="inline-flex items-center gap-2 rounded-xl bg-zinc-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6h12v12H6z" />
            </svg>
            Stop
          </button>
        )}
      </div>

      {/* Live Metrics */}
      <section aria-labelledby="live-metrics-heading" className="w-full mt-2">
        <CardSectionLabel id="live-metrics-heading">Live Metrics</CardSectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {METRIC_DEFS.map(({ key, label, unit, icon }) => {
            const value = metrics[key];
            return (
              <Card key={key} padding="sm">
                <div className="flex items-center gap-2 mb-3 text-zinc-400 dark:text-zinc-500">
                  {icon}
                  <span className="text-xs font-medium uppercase tracking-wide leading-tight">
                    {label}
                  </span>
                </div>
                <p className="text-2xl font-semibold text-zinc-300 dark:text-zinc-600 mb-1 tabular-nums">
                  {value !== undefined ? value : "—"}
                </p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500">
                  {unit}&nbsp;·&nbsp;{value !== undefined ? "live" : "awaiting feed"}
                </p>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
