"use client";

import { useState, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const busy = emailLoading || googleLoading;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setEmailLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      const requestedRedirect = searchParams.get("redirectTo");
      const nextPath =
        requestedRedirect && requestedRedirect.startsWith("/")
          ? requestedRedirect
          : "/dashboard";

      router.push(nextPath);
      router.refresh();
    } catch (error: any) {
      const message = String(error?.message || "Invalid login credentials");
      const looksLikeInvalidCreds = /invalid login credentials|invalid credentials/i.test(
        message,
      );
      setError(
        looksLikeInvalidCreds
          ? "Invalid email or password. If you created your account with Google, use Continue with Google above — your Gmail password won’t work here."
          : message,
      );
    } finally {
      setEmailLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const requestedRedirect = searchParams.get("redirectTo");
      const nextPath =
        requestedRedirect && requestedRedirect.startsWith("/")
          ? requestedRedirect
          : "/dashboard";
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        },
      });
      if (oauthError) throw oauthError;
    } catch (error: any) {
      setError(error.message);
      setGoogleLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-white to-gray-50 dark:from-gray-900 dark:to-gray-950 px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center">
          <Link href="/" className="flex items-center gap-1 mb-4">
            <Image
              src="/quotetree-icon.svg"
              alt="QuoteTree Logo"
              width={56}
              height={56}
              className="w-14 h-14"
            />
            <span className="text-2xl font-medium text-green-700">QuoteTree</span>
          </Link>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Log in to your account
          </p>
        </div>

        <div className="mt-8 space-y-6">
          <div className="space-y-4 rounded-lg bg-white dark:bg-gray-800 p-8 shadow-sm border border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={handleGoogle}
              disabled={busy}
              className="w-full flex items-center justify-center gap-3 rounded-md border border-gray-300 bg-white px-4 py-3 min-h-11 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50"
            >
              <GoogleIcon />
              {googleLoading ? "Redirecting to Google..." : "Continue with Google"}
            </button>

            <div className="flex items-center gap-3 py-1">
              <div className="h-px flex-1 bg-gray-200 dark:bg-gray-600" />
              <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                OR
              </span>
              <div className="h-px flex-1 bg-gray-200 dark:bg-gray-600" />
            </div>

            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-green-500 focus:outline-none focus:ring-green-500"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-green-500 focus:outline-none focus:ring-green-500"
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
                  <p className="text-sm text-red-800 dark:text-red-400">
                    {error}
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-md bg-green-600 px-4 py-3 min-h-11 text-sm font-semibold text-white shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {emailLoading ? "Logging in..." : "Log in"}
              </button>

              <p className="text-center">
                <Link
                  href="/auth/forgot-password"
                  className="text-sm text-green-600 hover:text-green-700 font-medium"
                >
                  Forgot password?
                </Link>
              </p>
            </form>
          </div>

          <p className="text-center text-sm text-gray-600 dark:text-gray-400">
            Don&apos;t have an account?{" "}
            <Link
              href="/auth/signup"
              className="font-medium text-green-600 hover:text-green-500"
            >
              Sign up for free
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.5-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.3 26.8 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l.0.0 6.2 5.2C39.2 36.3 44 31 44 24c0-1.3-.1-2.5-.4-3.5z"
      />
    </svg>
  );
}

export default function SignIn() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    }>
      <SignInForm />
    </Suspense>
  );
}

