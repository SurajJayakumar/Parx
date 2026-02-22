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

interface InferenceResult {
  probability: number;
  detected: boolean;
  fallProbability: number;
  fallDetected: boolean;
  severity: "low" | "medium" | "high";
  backend?: {
    pdnet?: string;
    pdnet_fall?: string;
  };
  updatedAt: number;
  symptomsSpike: boolean;
}

const INFERENCE_API_URL =
  process.env.NEXT_PUBLIC_INFERENCE_API_URL ??
  "http://127.0.0.1:8000/predict/features";
const SEQ_LEN = 100;
const FEATURE_DIM = 124;
const INFER_EVERY_N_FRAMES = 6;
const INFER_MIN_FRAMES = 30;
const SYMPTOM_SPIKE_THRESHOLD = 0.7;

const IDX = {
  LH_IP: 23,
  RH_IP: 24,
  LS: 11,
  RS: 12,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_WRIST: 15,
  R_WRIST: 16,
  L_HIP: 23,
  R_HIP: 24,
  L_KNEE: 25,
  R_KNEE: 26,
  L_ANKLE: 27,
  R_ANKLE: 28,
} as const;

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

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function vecSub(a: number[], b: number[]) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vecNorm(v: number[]) {
  return Math.hypot(v[0], v[1], v[2]);
}

function vecDot(a: number[], b: number[]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function angle(a: number[], b: number[], c: number[]) {
  const ba = vecSub(a, b);
  const bc = vecSub(c, b);
  const cos = vecDot(ba, bc) / (vecNorm(ba) * vecNorm(bc) + 1e-8);
  return Math.acos(clamp(cos, -1, 1));
}

function zeroPose() {
  return Array.from({ length: 33 }, () => [0, 0, 0, 0]);
}

function landmarksToArray(landmarks: Array<{ x?: number; y?: number; z?: number; visibility?: number }> | undefined) {
  if (!landmarks || landmarks.length !== 33) {
    return zeroPose();
  }

  return landmarks.map((lm) => [
    lm.x ?? 0,
    lm.y ?? 0,
    lm.z ?? 0,
    lm.visibility ?? 1,
  ]);
}

function normalizePose(poseXYZV: number[][]) {
  const lh = poseXYZV[IDX.LH_IP].slice(0, 3);
  const rh = poseXYZV[IDX.RH_IP].slice(0, 3);
  const hipCenter = [(lh[0] + rh[0]) / 2, (lh[1] + rh[1]) / 2, (lh[2] + rh[2]) / 2];

  const ls = poseXYZV[IDX.LS].slice(0, 3);
  const rs = poseXYZV[IDX.RS].slice(0, 3);
  const shoulders = [(ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2, (ls[2] + rs[2]) / 2];
  const torsoLen = vecNorm(vecSub(shoulders, hipCenter)) + 1e-6;

  return poseXYZV.map((p) => {
    const coords = [
      (p[0] - hipCenter[0]) / torsoLen,
      (p[1] - hipCenter[1]) / torsoLen,
      (p[2] - hipCenter[2]) / torsoLen,
    ];
    return [coords[0], coords[1], coords[2], p[3]];
  });
}

function computeAngles(poseNorm: number[][]) {
  const p = poseNorm.map((v) => v.slice(0, 3));
  const shoulderElbowWristL = angle(
    p[IDX.L_SHOULDER],
    p[IDX.L_ELBOW],
    p[IDX.L_WRIST],
  );
  const shoulderElbowWristR = angle(
    p[IDX.R_SHOULDER],
    p[IDX.R_ELBOW],
    p[IDX.R_WRIST],
  );
  const hipKneeAnkleL = angle(p[IDX.L_HIP], p[IDX.L_KNEE], p[IDX.L_ANKLE]);
  const hipKneeAnkleR = angle(p[IDX.R_HIP], p[IDX.R_KNEE], p[IDX.R_ANKLE]);
  const shoulderVec = [
    p[IDX.R_SHOULDER][0] - p[IDX.L_SHOULDER][0],
    p[IDX.R_SHOULDER][1] - p[IDX.L_SHOULDER][1],
  ];
  const torsoYawProxy = Math.atan2(shoulderVec[1], shoulderVec[0]);

  return [
    shoulderElbowWristL,
    shoulderElbowWristR,
    hipKneeAnkleL,
    hipKneeAnkleR,
    torsoYawProxy,
  ];
}

function handFeatures(handLandmarks: Array<{ x?: number; y?: number; z?: number }> | undefined) {
  if (!handLandmarks || handLandmarks.length !== 21) {
    return Array(10).fill(0);
  }

  const arr = handLandmarks.map((lm) => [lm.x ?? 0, lm.y ?? 0, lm.z ?? 0]);
  const thumbTip = arr[4];
  const indexTip = arr[8];
  const dist = vecNorm(vecSub(thumbTip, indexTip));

  const tips = [arr[4], arr[8], arr[12], arr[16], arr[20]];
  const means = [0, 1, 2].map(
    (k) => tips.reduce((sum, tip) => sum + tip[k], 0) / tips.length,
  );
  const spread =
    [0, 1, 2]
      .map((k) => {
        const mean = means[k];
        return Math.sqrt(
          tips.reduce((sum, tip) => sum + (tip[k] - mean) * (tip[k] - mean), 0) /
            tips.length,
        );
      })
      .reduce((acc, next) => acc + next, 0) / 3;

  const xs = arr.map((v) => v[0]);
  const ys = arr.map((v) => v[1]);
  const velocityPlaceholder = 0;

  return [
    dist,
    spread,
    velocityPlaceholder,
    xs.reduce((a, b) => a + b, 0) / xs.length,
    ys.reduce((a, b) => a + b, 0) / ys.length,
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
    arr[8][2],
  ];
}

function radToDeg(rad: number) {
  return (rad * 180) / Math.PI;
}

export default function CameraCapture({
  onMetricsSnapshot,
  onSessionEnd,
}: CameraCaptureProps = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const holisticRef = useRef<{ send: (args: { image: HTMLVideoElement }) => Promise<void>; close?: () => Promise<void> | void } | null>(null);
  const runningRef = useRef(false);
  const frameLoopRef = useRef<number | null>(null);
  const featureBufferRef = useRef<number[][]>([]);
  const frameCountRef = useRef(0);
  const inferBusyRef = useRef(false);
  const prevHipRef = useRef<number[] | null>(null);
  const prevTsRef = useRef<number | null>(null);
  const metricsRef = useRef<MotionMetrics>({});
  const metricsTickRef = useRef<number>(0);
  const spikeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [metrics, setMetrics] = useState<MotionMetrics>({});
  const [inference, setInference] = useState<InferenceResult | null>(null);
  const [inferenceError, setInferenceError] = useState<string>("");
  const [symptomSpike, setSymptomSpike] = useState(false);

  // Keep callback refs stable so interval/cleanup closures always see latest
  const onMetricsSnapshotRef = useRef(onMetricsSnapshot);
  const onSessionEndRef = useRef(onSessionEnd);
  useEffect(() => { onMetricsSnapshotRef.current = onMetricsSnapshot; }, [onMetricsSnapshot]);
  useEffect(() => { onSessionEndRef.current = onSessionEnd; }, [onSessionEnd]);
  useEffect(() => { metricsRef.current = metrics; }, [metrics]);

  // Notify parent whenever metrics change while active
  useEffect(() => {
    if (cameraState === "active") {
      onMetricsSnapshotRef.current?.(metrics);
    }
  }, [metrics, cameraState]);

  const triggerSymptomSpike = useCallback(() => {
    setSymptomSpike(true);
    if (spikeTimerRef.current) {
      clearTimeout(spikeTimerRef.current);
    }
    spikeTimerRef.current = setTimeout(() => {
      setSymptomSpike(false);
      spikeTimerRef.current = null;
    }, 1800);
  }, []);

  const getFixedWindow = useCallback(() => {
    const featureBuffer = featureBufferRef.current;
    if (featureBuffer.length === 0) {
      return null;
    }

    if (featureBuffer.length >= SEQ_LEN) {
      return featureBuffer.slice(-SEQ_LEN);
    }

    const first = featureBuffer[0];
    const padCount = SEQ_LEN - featureBuffer.length;
    const pads = Array.from({ length: padCount }, () => [...first]);
    return [...pads, ...featureBuffer];
  }, []);

  const runInference = useCallback(async () => {
    if (inferBusyRef.current) {
      return;
    }

    const window = getFixedWindow();
    if (!window) {
      return;
    }

    inferBusyRef.current = true;

    try {
      const resp = await fetch(INFERENCE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: window, seq_len: SEQ_LEN }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Inference API ${resp.status}: ${text}`);
      }

      const out = (await resp.json()) as {
        pdnet_probability?: number;
        pdnet_detected?: boolean;
        pdnet_fall_probability?: number;
        pdnet_fall_detected?: boolean;
        fall_flag?: boolean;
        severity?: "low" | "medium" | "high";
        parkinson_probability?: number;
        parkinson_detected?: boolean;
        backend?: {
          pdnet?: string;
          pdnet_fall?: string;
        };
      };

      const probability = Number(out.pdnet_probability ?? out.parkinson_probability ?? 0);
      const detected = Boolean(out.pdnet_detected ?? out.parkinson_detected);
      const fallProbability = Number(out.pdnet_fall_probability ?? 0);
      const fallDetected = Boolean(out.pdnet_fall_detected ?? out.fall_flag);
      const severity = out.severity ?? (fallDetected ? "high" : detected ? "medium" : "low");
      const symptomsSpikeNow =
        fallDetected || severity !== "low" || detected || probability >= SYMPTOM_SPIKE_THRESHOLD;

      setInference({
        probability,
        detected,
        fallProbability,
        fallDetected,
        severity,
        backend: out.backend,
        updatedAt: Date.now(),
        symptomsSpike: symptomsSpikeNow,
      });
      setInferenceError("");

      if (symptomsSpikeNow) {
        triggerSymptomSpike();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setInferenceError(msg);
    } finally {
      inferBusyRef.current = false;
    }
  }, [getFixedWindow, triggerSymptomSpike]);

  const frameToFeature = useCallback((results: {
    poseLandmarks?: Array<{ x?: number; y?: number; z?: number; visibility?: number }>;
    leftHandLandmarks?: Array<{ x?: number; y?: number; z?: number }>;
    rightHandLandmarks?: Array<{ x?: number; y?: number; z?: number }>;
  }) => {
    const pose = landmarksToArray(results.poseLandmarks);
    const poseNorm = normalizePose(pose);

    const coords2d = poseNorm.flatMap((v) => [v[0], v[1]]);
    const angles = computeAngles(poseNorm);
    const lh = handFeatures(results.leftHandLandmarks);
    const rh = handFeatures(results.rightHandLandmarks);
    const vis = poseNorm.map((v) => v[3]);

    const feat = [...coords2d, ...angles, ...lh, ...rh, ...vis].map((v) =>
      Number.isFinite(v) ? v : 0,
    );

    if (feat.length !== FEATURE_DIM) {
      throw new Error(`Feature length mismatch: got ${feat.length}, expected ${FEATURE_DIM}`);
    }

    const leftArm = radToDeg(angles[0]);
    const rightArm = radToDeg(angles[1]);
    const leftAnkle = poseNorm[IDX.L_ANKLE].slice(0, 3);
    const rightAnkle = poseNorm[IDX.R_ANKLE].slice(0, 3);
    const stepLengthProxy = vecNorm(vecSub(leftAnkle, rightAnkle)) * 100;

    const lhPose = poseNorm[IDX.L_HIP].slice(0, 3);
    const rhPose = poseNorm[IDX.R_HIP].slice(0, 3);
    const hipCenter = [
      (lhPose[0] + rhPose[0]) / 2,
      (lhPose[1] + rhPose[1]) / 2,
      (lhPose[2] + rhPose[2]) / 2,
    ];

    const now = performance.now();
    let walkingSpeed: number | undefined;
    if (prevHipRef.current && prevTsRef.current !== null) {
      const dt = (now - prevTsRef.current) / 1000;
      if (dt > 0) {
        walkingSpeed = vecNorm(vecSub(hipCenter, prevHipRef.current)) / dt;
      }
    }
    prevHipRef.current = hipCenter;
    prevTsRef.current = now;

    const snapshot: MotionMetrics = {
      armSwingL: Number.isFinite(leftArm) ? Number(leftArm.toFixed(1)) : undefined,
      armSwingR: Number.isFinite(rightArm) ? Number(rightArm.toFixed(1)) : undefined,
      stepLength: Number.isFinite(stepLengthProxy)
        ? Number(stepLengthProxy.toFixed(1))
        : undefined,
      walkingSpeed:
        walkingSpeed !== undefined && Number.isFinite(walkingSpeed)
          ? Number(walkingSpeed.toFixed(2))
          : undefined,
    };

    return { feat, snapshot };
  }, []);

  const stopStream = useCallback(async () => {
    runningRef.current = false;

    if (frameLoopRef.current !== null) {
      cancelAnimationFrame(frameLoopRef.current);
      frameLoopRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (holisticRef.current?.close) {
      try {
        await holisticRef.current.close();
      } catch {
        // no-op cleanup best effort
      }
    }
    holisticRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    featureBufferRef.current = [];
    frameCountRef.current = 0;
    inferBusyRef.current = false;
    prevHipRef.current = null;
    prevTsRef.current = null;

    onSessionEndRef.current?.(metricsRef.current);
    setCameraState("idle");
  }, []);

  const startStream = useCallback(async () => {
    setErrorMessage("");
    setInferenceError("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });

      streamRef.current = stream;

      const videoEl = videoRef.current;
      if (!videoEl) {
        throw new Error("Camera element is unavailable.");
      }

      videoEl.srcObject = stream;
      await videoEl.play();

      const { Holistic } = await import("@mediapipe/holistic");
      const holistic = new Holistic({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`,
      });

      holistic.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      holistic.onResults(async (results: {
        poseLandmarks?: Array<{ x?: number; y?: number; z?: number; visibility?: number }>;
        leftHandLandmarks?: Array<{ x?: number; y?: number; z?: number }>;
        rightHandLandmarks?: Array<{ x?: number; y?: number; z?: number }>;
      }) => {
        if (!runningRef.current) {
          return;
        }

        try {
          const { feat, snapshot } = frameToFeature(results);
          featureBufferRef.current.push(feat);
          if (featureBufferRef.current.length > SEQ_LEN) {
            featureBufferRef.current.splice(0, featureBufferRef.current.length - SEQ_LEN);
          }

          const now = performance.now();
          if (now - metricsTickRef.current > 250) {
            metricsTickRef.current = now;
            setMetrics(snapshot);
          }
        } catch {
          // skip invalid frame features
          return;
        }

        frameCountRef.current += 1;
        if (
          featureBufferRef.current.length >= INFER_MIN_FRAMES &&
          frameCountRef.current % INFER_EVERY_N_FRAMES === 0
        ) {
          await runInference();
        }
      });

      holisticRef.current = holistic;
      runningRef.current = true;

      const processFrame = async () => {
        if (!runningRef.current || !videoRef.current || !holisticRef.current) {
          return;
        }

        if (videoRef.current.readyState >= 2) {
          await holisticRef.current.send({ image: videoRef.current });
        }

        frameLoopRef.current = requestAnimationFrame(() => {
          void processFrame();
        });
      };

      frameLoopRef.current = requestAnimationFrame(() => {
        void processFrame();
      });

      setCameraState("active");
    } catch (err) {
      await stopStream();
      setErrorMessage(getErrorMessage(err));
      setCameraState("error");
    }
  }, [frameToFeature, runInference, stopStream]);

  useEffect(() => {
    return () => {
      if (spikeTimerRef.current) {
        clearTimeout(spikeTimerRef.current);
      }
      void stopStream();
    };
  }, [stopStream]);

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

        {cameraState === "active" && (inference?.detected || inference?.fallDetected || symptomSpike) && (
          <>
            <div className="pointer-events-none absolute inset-0 bg-red-500/20 animate-pulse" />
            <div className="pointer-events-none absolute -left-10 top-1/3 h-32 w-32 rounded-full bg-red-500/30 blur-2xl animate-ping" />
            <div className="pointer-events-none absolute right-[-2.5rem] top-1/2 h-36 w-36 rounded-full bg-red-500/30 blur-2xl animate-ping" />
            <div className="pointer-events-none absolute left-1/3 -bottom-10 h-40 w-40 rounded-full bg-red-600/30 blur-3xl animate-pulse" />
          </>
        )}

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

      {(inference?.symptomsSpike || symptomSpike) && (
        <div className="w-full rounded-2xl border border-red-400/60 bg-red-500/10 px-4 py-3">
          <p className="text-sm font-semibold text-red-500 dark:text-red-300">
            Symptom spike alert
          </p>
          <p className="mt-1 text-xs text-red-500/90 dark:text-red-300/90">
            Parkinson likelihood spiked to {(inference?.probability ?? 0).toFixed(2)}.
            Please pause and review this session.
          </p>
          {inference?.fallDetected && (
            <p className="mt-1 text-xs font-semibold text-red-600 dark:text-red-300">
              Fall detected by pdnet_fall.
            </p>
          )}
        </div>
      )}

      {cameraState === "active" && (
        <div className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/70 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-zinc-600 dark:text-zinc-300">
            <span>
              Inference: {inference ? (inference.detected ? "Parkinson detected" : "No Parkinson") : "warming up…"}
            </span>
            <span>
              PD Prob: {inference ? inference.probability.toFixed(3) : "—"}
            </span>
            <span>
              Fall Prob: {inference ? inference.fallProbability.toFixed(3) : "—"}
            </span>
            <span>
              Severity: {inference?.severity?.toUpperCase() ?? "—"}
            </span>
            <span>
              Fall Flag: {inference ? (inference.fallDetected ? "YES" : "NO") : "—"}
            </span>
            <span>
              Backend(pd): {inference?.backend?.pdnet ?? "—"}
            </span>
            <span>
              Backend(fall): {inference?.backend?.pdnet_fall ?? "—"}
            </span>
          </div>
          {inferenceError && (
            <p className="mt-1 text-xs text-red-500 dark:text-red-300">
              Inference error: {inferenceError}
            </p>
          )}
        </div>
      )}

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
            onClick={() => {
              void stopStream();
            }}
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
