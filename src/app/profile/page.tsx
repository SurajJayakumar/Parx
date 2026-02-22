"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthGate from "@/components/AuthGate";
import { Card, CardSectionLabel } from "@/components/ui/Card";
import { useAuth } from "@/lib/useAuth";
import { signOutUser } from "@/lib/firebaseAuth";
import { getUserProfile, saveUserProfile } from "@/lib/profile/profileStore";

const DEBUG = process.env.NODE_ENV === "development";

// ---------------------------------------------------------------------------
// Demo helpers
// ---------------------------------------------------------------------------

type DemoResult = { ok: true; detail?: string } | { ok: false; error: string };

async function demoFetch(
  url: string,
  body: Record<string, unknown>,
): Promise<DemoResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) {
      return { ok: false, error: json.error ?? `HTTP ${res.status}` };
    }
    const detail = json.severity
      ? `severity=${json.severity} score=${json.riskScore} sent=${json.sent}`
      : undefined;
    return { ok: true, detail };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export default function ProfilePage() {
  const { user } = useAuth();
  const router = useRouter();

  const [patientName, setPatientName] = useState("");
  const [caregiverEmail, setCaregiverEmail] = useState("");
  const [emailNotifications, setEmailNotifications] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [toast, setToast] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  type DemoKey = "highRisk" | "reportReady" | "weeklySummary";
  const [demoLoading, setDemoLoading] = useState<DemoKey | null>(null);
  const [demoResults, setDemoResults] = useState<Partial<Record<DemoKey, DemoResult>>>({});

  async function runDemo(
    key: DemoKey,
    buildBody: (email: string, name: string) => Record<string, unknown>,
  ) {
    setDemoLoading(key);
    setDemoResults((prev) => ({ ...prev, [key]: undefined }));

    let result: DemoResult;

    const profile = await getUserProfile();

    if (!profile || !profile.caregiverEmail.trim()) {
      result = { ok: false, error: "No caregiver email saved. Fill in the Profile form and save first." };
    } else if (!profile.emailNotificationsEnabled) {
      result = { ok: false, error: "Email notifications are disabled. Enable them in the Profile form and save first." };
    } else {
      const url = key === "highRisk"
        ? "/api/sessions/ingest"
        : key === "reportReady"
          ? "/api/reports/notify"
          : "/api/alerts/weekly";
      result = await demoFetch(url, buildBody(profile.caregiverEmail, profile.patientName || "Demo Patient"));
    }

    setDemoResults((prev) => ({ ...prev, [key]: result }));
    setDemoLoading(null);
  }

  function triggerHighRisk() {
    const origin = window.location.origin;
    runDemo("highRisk", (caregiverEmail, patientName) => ({
      caregiverEmail,
      patientName,
      metrics: { walkingSpeed: 0.65, stepLength: 0.42, armSwing: 0.28 },
      dashboardUrl: `${origin}/dashboard`,
    }));
  }

  function triggerReportReady() {
    const origin = window.location.origin;
    runDemo("reportReady", (caregiverEmail, patientName) => ({
      caregiverEmail,
      patientName,
      reportDate: new Date().toISOString().slice(0, 10),
      severity: "medium",
      riskScore: 62,
      dashboardUrl: `${origin}/dashboard`,
      reportUrl: `${origin}/dashboard`,
    }));
  }

  function triggerWeeklySummary() {
    const origin = window.location.origin;
    runDemo("weeklySummary", (caregiverEmail, patientName) => ({
      caregiverEmail,
      patientName,
      weekRange: "Feb 16–22, 2026",
      metrics: { walkingSpeed: 0.9, stepLength: 0.58, armSwing: 0.44 },
      trendSummary: "Gait stability improved slightly compared to last week.",
      dashboardUrl: `${origin}/dashboard`,
    }));
  }

  // Load profile from Firestore once on mount
  useEffect(() => {
    getUserProfile().then((profile) => {
      if (!profile) return;
      setPatientName(profile.patientName);
      setCaregiverEmail(profile.caregiverEmail);
      setEmailNotifications(profile.emailNotificationsEnabled);
    });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    const trimmedEmail = caregiverEmail.trim();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
    if (!emailValid) {
      setEmailError("Please enter a valid email address.");
      return;
    }
    setEmailError("");
    setCaregiverEmail(trimmedEmail);

    setSaving(true);
    try {
      await saveUserProfile({
        patientName,
        caregiverEmail: trimmedEmail,
        emailNotificationsEnabled: emailNotifications,
      });
      setToast(true);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(false), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOutUser();
      router.replace("/login");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <AuthGate>
      <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 mb-1">
        Profile
      </h1>
      <p className="text-zinc-500 dark:text-zinc-400 mb-8 text-sm">
        Manage your patient&apos;s information and notification preferences.
      </p>

      {/* Account info */}
      <section className="mb-4">
        <CardSectionLabel>Account</CardSectionLabel>
        <Card>
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-0.5">Email</p>
              <p className="text-sm text-zinc-900 dark:text-zinc-50">{user?.email ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-0.5">User ID</p>
              <p className="text-sm font-mono text-zinc-500 dark:text-zinc-400 break-all">{user?.uid ?? "—"}</p>
            </div>
          </div>
        </Card>
      </section>

      <form onSubmit={handleSave} noValidate>
        {/* Patient */}
        <section className="mb-4">
          <CardSectionLabel>Patient</CardSectionLabel>
          <Card>
            <label
              htmlFor="patient-name"
              className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5"
            >
              Patient Name
            </label>
            <input
              id="patient-name"
              type="text"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              placeholder="Enter patient name"
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50"
            />
          </Card>
        </section>

        {/* Caregiver */}
        <section className="mb-4">
          <CardSectionLabel>Caregiver</CardSectionLabel>
          <Card>
            <label
              htmlFor="caregiver-email"
              className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5"
            >
              Your Email
            </label>
            <input
              id="caregiver-email"
              type="email"
              value={caregiverEmail}
              onChange={(e) => { setCaregiverEmail(e.target.value); setEmailError(""); }}
              placeholder="caregiver@example.com"
              aria-describedby={emailError ? "email-error" : undefined}
              className={`w-full rounded-xl border bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50 ${
                emailError
                  ? "border-red-400 dark:border-red-500"
                  : "border-zinc-200 dark:border-zinc-700"
              }`}
            />
            {emailError && (
              <p id="email-error" className="mt-1.5 text-xs text-red-500 dark:text-red-400">
                {emailError}
              </p>
            )}
          </Card>
        </section>

        {/* Notifications */}
        <section className="mb-8">
          <CardSectionLabel>Notifications</CardSectionLabel>
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Email Notifications
                </p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Receive updates and reports via email
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={emailNotifications}
                onClick={() => setEmailNotifications((prev) => !prev)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-zinc-900 ${
                  emailNotifications
                    ? "bg-zinc-900 dark:bg-zinc-50"
                    : "bg-zinc-200 dark:bg-zinc-700"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full shadow transition-transform ${
                    emailNotifications
                      ? "translate-x-6 bg-white dark:bg-zinc-900"
                      : "translate-x-1 bg-white dark:bg-zinc-400"
                  }`}
                />
              </button>
            </div>
          </Card>
        </section>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex items-center gap-2 rounded-full border border-red-200 dark:border-red-800 px-5 py-2.5 text-sm font-medium text-red-600 dark:text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            {signingOut ? (
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
              </svg>
            )}
            {signingOut ? "Signing out…" : "Sign out"}
          </button>

          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-full bg-zinc-900 dark:bg-zinc-50 px-6 py-2.5 text-sm font-medium text-white dark:text-zinc-900 transition-opacity hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50 focus:ring-offset-2"
          >
            {saving && (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            )}
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>

      {/* Demo Controls — visible only in development */}
      {DEBUG && (
        <section className="mt-10">
          <CardSectionLabel>Demo Controls</CardSectionLabel>
          <Card>
            <p className="text-xs text-amber-600 dark:text-amber-400 mb-4 font-medium">
              Development only — uses the caregiver email and patient name saved above.
            </p>
            <div className="space-y-3">
              {(
                [
                  {
                    key: "highRisk" as const,
                    label: "Trigger High Risk Alert (Demo)",
                    handler: triggerHighRisk,
                  },
                  {
                    key: "reportReady" as const,
                    label: "Trigger Report Ready (Demo)",
                    handler: triggerReportReady,
                  },
                  {
                    key: "weeklySummary" as const,
                    label: "Trigger Weekly Summary (Demo)",
                    handler: triggerWeeklySummary,
                  },
                ] as const
              ).map(({ key, label, handler }) => {
                const result = demoResults[key];
                const loading = demoLoading === key;
                return (
                  <div key={key}>
                    <button
                      type="button"
                      onClick={handler}
                      disabled={demoLoading !== null}
                      className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50 focus:ring-offset-2 w-full text-left"
                    >
                      {loading && (
                        <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      )}
                      {label}
                    </button>
                    {result !== undefined && (
                      <p
                        className={`mt-1.5 text-xs px-1 ${
                          result.ok
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {result.ok
                          ? `Success${result.detail ? ` — ${result.detail}` : ""}`
                          : `Error: ${result.error}`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </section>
      )}

      {/* Toast */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
      >
        <div
          className={`flex items-center gap-2.5 rounded-2xl bg-zinc-900 dark:bg-zinc-50 px-5 py-3 text-sm font-medium text-white dark:text-zinc-900 shadow-lg transition-all duration-300 ${
            toast ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
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
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          Saved ✅
        </div>
      </div>
    </AuthGate>
  );
}
