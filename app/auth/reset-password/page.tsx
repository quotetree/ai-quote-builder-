"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  useEffect(() => {
    const establishSession = async () => {
      // Check if we got an expired error from the redirect
      if (searchParams.get('error') === 'expired') {
        setSessionError("Your password reset link has expired. Please request a new one below.");
        setSessionLoading(false);
        return;
      }

      // Check if there's a code parameter (PKCE flow)
      const code = searchParams.get('code');
      if (code) {
        console.log('🔄 Password reset code detected, exchanging...');
        try {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          
          if (error) {
            console.error('❌ Code exchange failed:', error);
            setSessionError(error.message || 'Failed to establish session');
            setSessionReady(false);
          } else if (data.session) {
            console.log('✅ Code exchange successful');
            setSessionReady(true);
          }
        } catch (err: any) {
          console.error('Exception during code exchange:', err);
          setSessionError(err.message || 'An error occurred');
          setSessionReady(false);
        }
        setSessionLoading(false);
        return;
      }

      // Check if there's already an active session
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session) {
        console.log('✅ Active session found');
        setSessionReady(true);
        setSessionLoading(false);
        return;
      }

      // If no active session, try hash-based tokens (legacy flow)
      const hash = window.location.hash;
      const params = new URLSearchParams(hash.substring(1)); // Remove '#'
      
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const type = params.get('type');
      
      console.log('=== Password Reset Session Setup ===');
      console.log('Hash params:', { 
        accessToken: accessToken ? `${accessToken.substring(0, 20)}...` : null, 
        refreshToken: !!refreshToken, 
        type 
      });
      
      // Check if this is a recovery flow with tokens
      if (type === 'recovery' && accessToken && refreshToken) {
        console.log('Setting session with tokens from URL hash...');
        
        try {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          
          console.log('setSession result:', { 
            hasSession: !!data.session, 
            hasUser: !!data.user,
            error: error ? error.message : null 
          });
          
          if (error) {
            console.error('Failed to set session:', error);
            setSessionError(error.message || 'Failed to establish session');
            setSessionReady(false);
          } else if (data.session) {
            console.log('✅ Session established successfully');
            setSessionReady(true);
          } else {
            console.error('No session returned from setSession');
            setSessionError('Failed to establish authentication session');
            setSessionReady(false);
          }
        } catch (err: any) {
          console.error('Exception during setSession:', err);
          setSessionError(err.message || 'An error occurred');
          setSessionReady(false);
        }
      } else if (!accessToken || !refreshToken) {
        // No tokens = user navigated directly or link is malformed
        console.log('No tokens found in URL hash');
        setSessionError('No password reset session found. Please use the link from your email.');
      } else if (type !== 'recovery') {
        console.log('Type is not recovery:', type);
        setSessionError('Invalid password reset link');
      }
      
      setSessionLoading(false);
    };
    
    establishSession();
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

    // Only allow submit if session is ready
    if (!sessionReady) {
      setError("Auth session not ready. Please wait or use the link from your email again.");
      return;
    }

    setLoading(true);

    try {
      console.log('Attempting to update password...');
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      });

      if (updateError) {
        console.error('Password update error:', updateError);
        setError(updateError.message);
      } else {
        console.log('✅ Password updated successfully');
        setSuccess(true);
        setTimeout(() => {
          router.push("/dashboard");
        }, 2000);
      }
    } catch (err: any) {
      console.error('Exception during password update:', err);
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-white to-gray-50 px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-1 mb-6">
            <Image
              src="/quotetree-icon.svg"
              alt="QuoteTree Logo"
              width={56}
              height={56}
              className="w-14 h-14"
            />
            <span className="text-2xl font-medium text-green-700">QuoteTree</span>
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            {success ? "Password Updated!" : sessionError ? "Link Expired" : "Set Your Password"}
          </h1>
          <p className="text-gray-600">
            {success
              ? "Redirecting you to your dashboard..."
              : sessionError
              ? "Your password reset link has expired or is invalid"
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
              <p className="text-gray-600">Validating your reset link...</p>
            </div>
          </div>
        ) : sessionError ? (
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
                {sessionError || "Password reset links expire for security reasons. Please request a new one."}
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

