"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInWithGoogle, signUpWithEmail } from "@/lib/firebaseAuth";
import { useAuth } from "@/lib/useAuth";

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3">
      <svg className="h-4 w-4 mt-0.5 shrink-0 text-red-500" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
      </svg>
      <p className="text-sm text-red-700 dark:text-red-400">{message}</p>
    </div>
  );
}

function Spinner() {
  return <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70" />;
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function friendlyError(err: unknown): string {
  if (!(err instanceof Error)) return "Something went wrong. Please try again.";
  const code = (err as { code?: string }).code ?? "";
  if (code === "auth/email-already-in-use") return "An account with this email already exists. Try signing in instead.";
  if (code === "auth/invalid-email") return "That doesn't look like a valid email address.";
  if (code === "auth/weak-password") return "Password must be at least 6 characters.";
  if (code === "auth/popup-closed-by-user") return "Sign-in popup was closed. Please try again.";
  if (code === "auth/network-request-failed") return "Network error. Check your connection and try again.";
  if (code === "auth/too-many-requests") return "Too many attempts. Please wait a moment and try again.";
  return err.message;
}

export default function SignupPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [user, loading, router]);

  async function handleEmailSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signUpWithEmail(email, password);
      router.replace("/dashboard");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
      router.replace("/dashboard");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-50" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900 dark:bg-zinc-50 shadow-lg">
            <svg className="h-6 w-6 text-white dark:text-zinc-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </span>
        </div>

        <h1 className="text-2xl font-bold text-center text-zinc-900 dark:text-zinc-50 mb-1">
          Create your account
        </h1>
        <p className="text-sm text-center text-zinc-500 dark:text-zinc-400 mb-8">
          Start monitoring your patient&apos;s mobility today
        </p>

        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
          {error && <ErrorBanner message={error} />}

          <form onSubmit={handleEmailSignUp} noValidate className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50"
              />
              <p className="mt-1.5 text-xs text-zinc-400">Must be at least 6 characters</p>
            </div>

            <button
              type="submit"
              disabled={busy || !email || !password}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 dark:bg-zinc-50 py-2.5 text-sm font-medium text-white dark:text-zinc-900 transition-opacity hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50 focus:ring-offset-2"
            >
              {busy && <Spinner />}
              {busy ? "Creating account…" : "Create account"}
            </button>
          </form>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-zinc-100 dark:bg-zinc-800" />
            <span className="text-xs text-zinc-400 dark:text-zinc-500">or</span>
            <div className="h-px flex-1 bg-zinc-100 dark:bg-zinc-800" />
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={busy}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-900 dark:text-zinc-50 shadow-sm transition hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50 focus:ring-offset-2"
          >
            {busy ? <Spinner /> : <GoogleIcon />}
            {busy ? "Signing in…" : "Continue with Google"}
          </button>
        </div>

        <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-zinc-900 dark:text-zinc-50 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
