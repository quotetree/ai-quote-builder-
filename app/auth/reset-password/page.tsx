"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [linkExpired, setLinkExpired] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  useEffect(() => {
    // Check if we got an expired error from the redirect
    if (searchParams.get('error') === 'expired') {
      setLinkExpired(true);
      setError("Your password reset link has expired. Please request a new one below.");
      setSessionLoading(false);
      return;
    }

    // Check for hash token and wait for Supabase to establish session
    const checkSession = async () => {
      try {
        // Give Supabase time to process the hash token
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error('Session error:', sessionError);
          setError("Failed to establish authentication session. Please try the link again.");
          setSessionLoading(false);
          return;
        }

        if (session) {
          console.log('Session established successfully');
          setHasSession(true);
          setSessionLoading(false);
        } else {
          // No session and no hash token means user navigated here directly
          const hash = window.location.hash;
          if (!hash || !hash.includes('access_token')) {
            setError("No password reset session found. Please use the link from your email.");
            setSessionLoading(false);
          } else {
            // Has token but session not ready yet, wait a bit more
            await new Promise(resolve => setTimeout(resolve, 1000));
            const { data: { session: retrySession } } = await supabase.auth.getSession();
            if (retrySession) {
              setHasSession(true);
            } else {
              setError("Authentication session expired or invalid. Please request a new password reset link.");
            }
            setSessionLoading(false);
          }
        }
      } catch (err) {
        console.error('Error checking session:', err);
        setError("An error occurred. Please try again.");
        setSessionLoading(false);
      }
    };

    checkSession();
  }, [searchParams, supabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    // Double-check session before attempting update
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setError("Auth session missing! Please use the link from your email again.");
      return;
    }

    setLoading(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      });

      if (updateError) {
        setError(updateError.message);
      } else {
        setSuccess(true);
        setTimeout(() => {
          router.push("/dashboard");
        }, 2000);
      }
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-white to-gray-50 px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-10 h-10 bg-gradient-to-br from-green-600 to-green-700 rounded-lg flex items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-6 h-6 text-white"
              >
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
            <span className="text-2xl font-bold text-gray-900">QuoteTree</span>
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            {success ? "Password Updated!" : linkExpired ? "Link Expired" : "Set Your Password"}
          </h1>
          <p className="text-gray-600">
            {success
              ? "Redirecting you to your dashboard..."
              : linkExpired
              ? "Your password reset link has expired"
              : "Create a secure password for your account"}
          </p>
        </div>

        {sessionLoading ? (
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-blue-600 animate-spin"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </div>
              <p className="text-gray-600">Verifying your password reset link...</p>
            </div>
          </div>
        ) : linkExpired || (error && !hasSession) ? (
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-orange-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <p className="text-gray-600 mb-6">
                {error || "Password reset links expire for security reasons. Please request a new one."}
              </p>
              <Link
                href="/auth/forgot-password"
                className="block w-full py-3 px-4 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-colors text-center"
              >
                Request New Reset Link
              </Link>
              <Link
                href="/auth/signin"
                className="block w-full mt-3 py-3 px-4 bg-white text-gray-700 border-2 border-gray-300 rounded-lg font-semibold hover:bg-gray-50 transition-colors text-center"
              >
                Back to Login
              </Link>
            </div>
          </div>
        ) : success ? (
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <p className="text-gray-600">Your password has been set successfully!</p>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  New Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  placeholder="Enter your password"
                  minLength={6}
                />
              </div>

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  placeholder="Confirm your password"
                  minLength={6}
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-green-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Updating..." : "Set Password"}
              </button>
            </form>
          </div>
        )}

        <p className="text-center text-sm text-gray-500 mt-6">
          Need help?{" "}
          <a href="mailto:support@quotetree.com" className="text-green-600 hover:text-green-700 font-medium">
            Contact support
          </a>
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-white to-gray-50">
        <div className="text-gray-600">Loading...</div>
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}

