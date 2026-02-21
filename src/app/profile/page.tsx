"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthGate from "@/components/AuthGate";
import { Card, CardSectionLabel } from "@/components/ui/Card";
import { useAuth } from "@/lib/useAuth";
import { signOutUser } from "@/lib/firebaseAuth";

export default function ProfilePage() {
  const { user } = useAuth();
  const router = useRouter();

  const [patientName, setPatientName] = useState("");
  const [caregiverEmail, setCaregiverEmail] = useState("");
  const [emailNotifications, setEmailNotifications] = useState(false);
  const [toast, setToast] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setToast(true);
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
              onChange={(e) => setCaregiverEmail(e.target.value)}
              placeholder="caregiver@example.com"
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50"
            />
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
                onClick={() => setEmailNotifications((v) => !v)}
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
            className="rounded-full bg-zinc-900 dark:bg-zinc-50 px-6 py-2.5 text-sm font-medium text-white dark:text-zinc-900 transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50 focus:ring-offset-2"
          >
            Save
          </button>
        </div>
      </form>

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
          Saved locally (temporary)
        </div>
      </div>
    </AuthGate>
  );
}
