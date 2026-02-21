"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { signOutUser } from "@/lib/firebaseAuth";

export default function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();

  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close dropdown on route change
  useEffect(() => { setOpen(false); }, [pathname]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOutUser();
      router.replace("/login");
    } finally {
      setSigningOut(false);
      setOpen(false);
    }
  }

  const isProfile = pathname === "/profile";

  return (
    <header className="fixed top-0 inset-x-0 z-50">
      <div className="absolute inset-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-xl border-b border-zinc-200/70 dark:border-zinc-800/70" />
      <div className="relative mx-auto max-w-4xl px-4 sm:px-8 flex items-center justify-between h-14">

        {/* Logo */}
        <Link href="/dashboard" className="flex items-center gap-2 group">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 dark:bg-zinc-50">
            <svg className="h-4 w-4 text-white dark:text-zinc-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </span>
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 tracking-tight">
            ParkinsonAI
          </span>
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* Show auth buttons only when resolved and no user */}
          {!loading && !user && (
            <>
              <Link
                href="/login"
                className="rounded-full border border-zinc-200 dark:border-zinc-700 px-4 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-full bg-zinc-900 dark:bg-zinc-50 px-4 py-1.5 text-xs font-medium text-white dark:text-zinc-900 transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50"
              >
                Sign up
              </Link>
            </>
          )}

          {/* Profile dropdown — only when signed in */}
          {!loading && user && (
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-label="Profile menu"
                aria-expanded={open}
                className={[
                  "flex h-8 w-8 items-center justify-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50",
                  isProfile || open
                    ? "bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900"
                    : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-50",
                ].join(" ")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </button>

              {open && (
                <div className="absolute right-0 mt-2 w-52 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg shadow-zinc-900/10 dark:shadow-black/30 overflow-hidden">
                  {/* User info */}
                  <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
                    <p className="text-xs font-medium text-zinc-900 dark:text-zinc-50 truncate">
                      {user.displayName ?? "Caregiver"}
                    </p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
                      {user.email}
                    </p>
                  </div>

                  {/* Settings */}
                  <Link
                    href="/profile"
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <svg className="h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Settings
                  </Link>

                  {/* Sign out */}
                  <button
                    type="button"
                    onClick={handleSignOut}
                    disabled={signingOut}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors disabled:opacity-50"
                  >
                    {signingOut ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                      </svg>
                    )}
                    {signingOut ? "Signing out…" : "Sign out"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
