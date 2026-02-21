"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type CameraState = "idle" | "active" | "error";

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

export default function CameraCapture() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraState("idle");
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
    </div>
  );
}
