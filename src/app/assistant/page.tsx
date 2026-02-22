"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import AuthGate from "@/components/AuthGate";
import { useAuth } from "@/lib/useAuth";
import { db } from "@/lib/firebase/client";
import {
  collection,
  getDocs,
  orderBy,
  query,
  limit,
} from "firebase/firestore";

type CallStatus = "idle" | "listening" | "thinking" | "speaking" | "error";
type UserMode = "caregiver" | "clinician";

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface LatestReport {
  title: string;
  createdAt: string;
  summary?: string;
  observations?: string[];
  interpretation?: string;
  nextSteps?: string[];
  safetyNotes?: string[];
  highestSeverity?: string;
}

const STATUS_LABELS: Record<CallStatus, string> = {
  idle: "Tap to ask a follow-up",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  error: "Error — tap to retry",
};

const STATUS_COLORS: Record<CallStatus, string> = {
  idle: "text-zinc-400 dark:text-zinc-500",
  listening: "text-red-500",
  thinking: "text-amber-500",
  speaking: "text-blue-500",
  error: "text-red-500",
};

function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm"];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return "";
}

// ─── Animated thinking dots ───────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-2 w-2 rounded-full bg-amber-400"
          style={{
            animation: "thinking-bounce 1.2s ease-in-out infinite",
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Animated waveform bars ───────────────────────────────────────────────────

function SpeakingWave() {
  const heights = [0.4, 0.7, 1, 0.7, 0.5, 0.9, 0.6, 1, 0.5, 0.75];
  return (
    <div className="flex items-center gap-0.5 h-6" aria-label="Speaking">
      {heights.map((h, i) => (
        <span
          key={i}
          className="w-1 rounded-full bg-blue-500"
          style={{
            height: `${h * 100}%`,
            animation: "wave-pulse 1s ease-in-out infinite alternate",
            animationDelay: `${i * 0.08}s`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Build report context string for LLM ─────────────────────────────────────

function buildReportContext(report: LatestReport): string {
  const lines: string[] = [
    `Report title: ${report.title}`,
    `Generated: ${report.createdAt}`,
  ];
  if (report.highestSeverity) lines.push(`Overall severity: ${report.highestSeverity}`);
  if (report.summary) lines.push(`Summary: ${report.summary}`);
  if (report.observations?.length)
    lines.push(`Observations: ${report.observations.join("; ")}`);
  if (report.interpretation) lines.push(`Interpretation: ${report.interpretation}`);
  if (report.nextSteps?.length)
    lines.push(`Next steps: ${report.nextSteps.join("; ")}`);
  if (report.safetyNotes?.length)
    lines.push(`Safety notes: ${report.safetyNotes.join("; ")}`);
  return lines.join("\n");
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AssistantPage() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [mode, setMode] = useState<UserMode>("caregiver");
  const [latestReport, setLatestReport] = useState<LatestReport | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [greetingDone, setGreetingDone] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);

  const { user } = useAuth();

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const recordingStartRef = useRef<number>(0);

  const MIN_DURATION_MS = 500;
  const MIN_BLOB_BYTES = 1000;

  // ─── Fetch mic permission ────────────────────────────────────────────────────

  useEffect(() => {
    let mounted = true;
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => {
        if (mounted) streamRef.current = stream;
      })
      .catch(() => {
        if (mounted) setStatus("error");
      });

    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      revokeObjectUrl();
    };
  }, []);

  // ─── Fetch latest report from Firestore ──────────────────────────────────────

  useEffect(() => {
    if (!user?.uid) return;

    async function fetchLatestReport() {
      try {
        const snap = await getDocs(
          query(
            collection(db, "users", user!.uid, "reports"),
            orderBy("createdAt", "desc"),
            limit(1)
          )
        );
        if (!snap.empty) {
          const doc = snap.docs[0];
          const data = doc.data();

          const parseField = (val: unknown): string | undefined =>
            typeof val === "string" ? val : undefined;
          const parseArr = (val: unknown): string[] | undefined =>
            Array.isArray(val) ? (val as string[]) : undefined;

          const createdAt = data.createdAt?.toDate
            ? data.createdAt.toDate().toLocaleString()
            : typeof data.createdAt === "string"
            ? data.createdAt
            : "Unknown date";

          setLatestReport({
            title: parseField(data.title) ?? "Latest Report",
            createdAt,
            summary: parseField(data.summary),
            observations: parseArr(data.observations),
            interpretation: parseField(data.interpretation),
            nextSteps: parseArr(data.nextSteps),
            safetyNotes: parseArr(data.safetyNotes),
            highestSeverity: parseField(data.highestSeverity),
          });
        }
      } catch (err) {
        console.error("[assistant] Failed to fetch latest report:", err);
      } finally {
        setReportLoading(false);
      }
    }

    fetchLatestReport();
  }, [user?.uid]);

  // ─── Audio helpers ───────────────────────────────────────────────────────────

  function revokeObjectUrl() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }

  function stopSpeakingAudio() {
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.currentTime = 0;
      audioRef.current = null;
    }
    revokeObjectUrl();
    submittingRef.current = false;
  }

  // ─── Play audio buffer ───────────────────────────────────────────────────────

  function playAudioBuffer(
    audioBlob: Blob,
    onDone: () => void,
    onFail: () => void
  ) {
    revokeObjectUrl();
    const url = URL.createObjectURL(audioBlob);
    objectUrlRef.current = url;

    const audio = new Audio(url);
    audioRef.current = audio;

    audio.onended = () => {
      submittingRef.current = false;
      revokeObjectUrl();
      onDone();
    };

    audio.onerror = () => {
      submittingRef.current = false;
      revokeObjectUrl();
      onFail();
    };

    setStatus("speaking");
    audio.play();
  }

  // ─── Auto-play greeting when report is loaded ────────────────────────────────

  const playGreeting = useCallback(
    async (report: LatestReport, currentMode: UserMode) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setStatus("thinking");

      try {
        const res = await fetch("/api/voice/greet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reportContext: buildReportContext(report),
            mode: currentMode,
          }),
        });

        if (!res.ok || !res.headers.get("Content-Type")?.startsWith("audio/")) {
          submittingRef.current = false;
          setStatus("idle");
          setGreetingDone(true);
          return;
        }

        const greetingText = decodeURIComponent(
          res.headers.get("X-Greeting-Text") ?? ""
        );

        const audioBlob = await res.blob();
        playAudioBuffer(
          audioBlob,
          () => {
            setStatus("idle");
            setGreetingDone(true);
            if (greetingText) {
              setConversationHistory([{ role: "assistant", content: greetingText }]);
            }
          },
          () => {
            setStatus("idle");
            setGreetingDone(true);
          }
        );
      } catch {
        submittingRef.current = false;
        setStatus("idle");
        setGreetingDone(true);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    if (!reportLoading && latestReport && !greetingDone) {
      playGreeting(latestReport, mode);
    } else if (!reportLoading && !latestReport) {
      setGreetingDone(true);
    }
  }, [reportLoading, latestReport, greetingDone, mode, playGreeting]);

  // ─── Send user utterance ─────────────────────────────────────────────────────

  async function sendUtterance(blob: Blob): Promise<void> {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setStatus("thinking");

    try {
      const form = new FormData();
      form.append("file", blob, "utterance.webm");
      form.append("mode", mode);

      if (latestReport) {
        form.append("reportContext", buildReportContext(latestReport));
      }

      if (conversationHistory.length > 0) {
        // Keep last 6 turns to stay within token limits
        form.append(
          "history",
          JSON.stringify(conversationHistory.slice(-6))
        );
      }

      const res = await fetch("/api/voice/s2s", { method: "POST", body: form });
      const contentType = res.headers.get("Content-Type") ?? "";

      if (!res.ok || !contentType.startsWith("audio/")) {
        const json = await res.json().catch(() => ({ error: "Unknown error." }));
        console.error("[sendUtterance] API error:", json.error);
        submittingRef.current = false;
        setStatus("error");
        return;
      }

      const transcriptHeader = decodeURIComponent(
        res.headers.get("X-User-Transcript") ?? ""
      );
      const replyText = decodeURIComponent(
        res.headers.get("X-Assistant-Reply") ?? ""
      );

      const audioBlob = await res.blob();
      playAudioBuffer(
        audioBlob,
        () => {
          setStatus("idle");
          setConversationHistory((prev) => {
            const next = [...prev];
            if (transcriptHeader) next.push({ role: "user", content: transcriptHeader });
            if (replyText) next.push({ role: "assistant", content: replyText });
            return next;
          });
        },
        () => setStatus("error")
      );
    } catch {
      submittingRef.current = false;
      setStatus("error");
    }
  }

  function stopSpeaking() {
    stopSpeakingAudio();
    setStatus("idle");
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) {
      setStatus("error");
      return;
    }

    chunksRef.current = [];
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
      chunksRef.current = [];

      const duration = Date.now() - recordingStartRef.current;
      if (duration < MIN_DURATION_MS || blob.size < MIN_BLOB_BYTES) {
        setStatus("idle");
        return;
      }

      sendUtterance(blob);
    };

    recorder.start();
    recordingStartRef.current = Date.now();
    recorderRef.current = recorder;
    setStatus("listening");
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  function handleMicClick() {
    if (status === "thinking") return;

    if (status === "speaking") {
      stopSpeakingAudio();
      startRecording();
      return;
    }

    if (status === "listening") {
      stopRecording();
      return;
    }

    startRecording();
  }

  // ─── UI helpers ──────────────────────────────────────────────────────────────

  const micBg: Record<CallStatus, string> = {
    idle: "bg-zinc-100 dark:bg-zinc-800 hover:scale-105 active:scale-95",
    listening: "bg-red-500 scale-110 shadow-red-300 dark:shadow-red-900",
    thinking: "bg-zinc-200 dark:bg-zinc-700 cursor-not-allowed opacity-60",
    speaking: "bg-zinc-100 dark:bg-zinc-800 hover:scale-105 active:scale-95",
    error: "bg-zinc-100 dark:bg-zinc-800 hover:scale-105 active:scale-95",
  };

  const micIconColor: Record<CallStatus, string> = {
    idle: "text-zinc-700 dark:text-zinc-300",
    listening: "text-white",
    thinking: "text-zinc-400 dark:text-zinc-500",
    speaking: "text-zinc-700 dark:text-zinc-300",
    error: "text-red-500",
  };

  const showPingRing = status === "listening";

  // Determine the idle label based on whether a report is loaded
  const idleLabel =
    status === "idle"
      ? latestReport
        ? "Tap to ask a follow-up"
        : "Tap to speak"
      : STATUS_LABELS[status];

  const reportBadge = latestReport ? (
    <div className="flex items-center gap-2 rounded-full bg-zinc-100 dark:bg-zinc-800 px-4 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
      <span className="truncate max-w-[200px]">{latestReport.title}</span>
    </div>
  ) : null;

  return (
    <>
      <style>{`
        @keyframes thinking-bounce {
          0%, 100% { transform: translateY(0); opacity: 0.5; }
          50% { transform: translateY(-6px); opacity: 1; }
        }
        @keyframes wave-pulse {
          from { transform: scaleY(0.3); }
          to   { transform: scaleY(1); }
        }
      `}</style>

      <AuthGate>
        <div className="flex flex-col items-center justify-between min-h-[calc(100vh-8rem)] py-10 select-none">

          {/* Title */}
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 text-center">
            Parxx Voice Assistant
          </h1>

          {/* Center section */}
          <div className="flex flex-col items-center gap-8">

            {/* Report badge */}
            {!reportLoading && reportBadge}
            {reportLoading && (
              <div className="h-7 w-40 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
            )}

            {/* Mic button */}
            <div className="relative flex items-center justify-center">
              {showPingRing && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-40" />
              )}
              <button
                type="button"
                onClick={handleMicClick}
                disabled={status === "thinking" || reportLoading}
                aria-label={
                  status === "listening"
                    ? "Stop recording"
                    : status === "speaking"
                    ? "Interrupt and record"
                    : "Start recording"
                }
                className={[
                  "relative z-10 flex h-36 w-36 items-center justify-center rounded-full shadow-xl transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-offset-2 focus:ring-red-400",
                  micBg[status],
                ].join(" ")}
              >
                <svg
                  className={["h-14 w-14 transition-colors", micIconColor[status]].join(" ")}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
                  />
                </svg>
              </button>
            </div>

            {/* Status area */}
            <div className="flex h-8 items-center justify-center">
              {status === "thinking" && <ThinkingDots />}
              {status === "speaking" && <SpeakingWave />}
              {status !== "thinking" && status !== "speaking" && (
                <div className="flex items-center gap-2">
                  <span
                    className={[
                      "h-2.5 w-2.5 rounded-full transition-colors",
                      status === "listening" ? "bg-red-500 animate-pulse" :
                      status === "error"     ? "bg-red-500" :
                                              "bg-zinc-300 dark:bg-zinc-600",
                    ].join(" ")}
                  />
                  <span className={["text-sm font-medium tracking-wide", STATUS_COLORS[status]].join(" ")}>
                    {idleLabel}
                  </span>
                </div>
              )}
            </div>

            {/* Stop Speaking button */}
            {status === "speaking" && (
              <button
                type="button"
                onClick={stopSpeaking}
                className="flex items-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-5 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-300 shadow-sm transition-all hover:bg-zinc-50 dark:hover:bg-zinc-800 active:scale-95 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50 focus:ring-offset-2"
              >
                <svg className="h-4 w-4 text-blue-500" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
                Stop Speaking
              </button>
            )}

            {/* Mode toggle */}
            <div className="flex items-center gap-3">
              <span className={["text-sm font-medium transition-colors", mode === "caregiver" ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-400 dark:text-zinc-500"].join(" ")}>
                Caregiver
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={mode === "clinician"}
                onClick={() => setMode((m) => (m === "caregiver" ? "clinician" : "caregiver"))}
                className={[
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50 focus:ring-offset-2",
                  mode === "clinician" ? "bg-zinc-900 dark:bg-zinc-50" : "bg-zinc-300 dark:bg-zinc-600",
                ].join(" ")}
              >
                <span
                  className={[
                    "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-zinc-900 shadow-lg ring-0 transition duration-200 ease-in-out",
                    mode === "clinician" ? "translate-x-5" : "translate-x-0",
                  ].join(" ")}
                />
              </button>
              <span className={["text-sm font-medium transition-colors", mode === "clinician" ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-400 dark:text-zinc-500"].join(" ")}>
                Clinician
              </span>
            </div>
          </div>

          {/* Disclaimer */}
          <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center">
            Not a medical diagnosis.
          </p>
        </div>
      </AuthGate>
    </>
  );
}
