"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  RememberedAccount,
  accountInitials,
  displayNameForAccount,
  getRememberedAccounts,
  providerFromUser,
  providerLabel,
  rememberAccount,
  removeRememberedAccount,
} from "@/lib/rememberedAccounts";

type AuthPromptModalProps = {
  open: boolean;
  onClose: () => void;
};

type Step = "welcome" | "entry" | "password";

export default function AuthPromptModal({ open, onClose }: AuthPromptModalProps) {
  const router = useRouter();
  const titleId = useId();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<Step>("entry");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<RememberedAccount[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setEmail("");
      setPassword("");
      setError(null);
      setMessage(null);
      setLoading(false);
      return;
    }

    const remembered = getRememberedAccounts();
    setAccounts(remembered);
    setPassword("");
    setError(null);
    setMessage(null);
    setLoading(false);

    if (remembered.length > 0) {
      setStep("welcome");
      setMode("signin");
      setEmail("");
    } else {
      setStep("entry");
      setMode("signin");
      setEmail("");
    }
  }, [open]);

  if (!open || !mounted) return null;

  const handleOAuth = async (provider: "google" | "apple") => {
    setError(null);
    setLoading(true);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/dashboard")}`,
        },
      });
      if (oauthError) throw oauthError;
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Unable to continue with that provider.";
      setError(msg);
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (mode === "signin") {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;

        const user = data.user;
        if (user?.email) {
          const meta = user.user_metadata as Record<string, unknown> | undefined;
          const name =
            (typeof meta?.full_name === "string" && meta.full_name) ||
            (typeof meta?.name === "string" && meta.name) ||
            null;
          rememberAccount({
            email: user.email,
            name,
            provider: providerFromUser(user),
          });
        }

        router.push("/dashboard");
        router.refresh();
        onClose();
        return;
      }

      if (password.length < 6) {
        throw new Error("Password must be at least 6 characters");
      }

      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/dashboard")}`,
        },
      });
      if (signUpError) throw signUpError;

      rememberAccount({
        email: email.trim(),
        name: null,
        provider: "email",
      });
      setMessage(
        "Check your email for the confirmation link to complete signup.",
      );
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "Something went wrong.";
      const looksLikeInvalidCreds =
        /invalid login credentials|invalid credentials/i.test(raw);
      setError(
        looksLikeInvalidCreds
          ? "Invalid email or password. If you created this account with Google, use Continue with Google — your Gmail password won’t work here."
          : raw,
      );
    } finally {
      setLoading(false);
    }
  };

  const chooseAccount = (account: RememberedAccount) => {
    setError(null);
    setMessage(null);
    setPassword("");

    if (account.provider === "google") {
      void handleOAuth("google");
      return;
    }
    if (account.provider === "apple") {
      void handleOAuth("apple");
      return;
    }

    // Email accounts, or older saved accounts without a known provider.
    setEmail(account.email);
    setMode("signin");
    setStep("password");
  };

  const handleRemoveAccount = (account: RememberedAccount) => {
    removeRememberedAccount(account.email);
    const next = getRememberedAccounts();
    setAccounts(next);
    if (next.length === 0) {
      setStep("entry");
      setMode("signin");
    }
  };

  const title =
    step === "welcome"
      ? "Welcome back"
      : step === "password" && mode === "signup"
        ? "Create your account"
        : step === "password"
          ? "Log in with email"
          : "Log in or sign up";

  const subtitle =
    step === "welcome"
      ? "Choose an account to continue."
      : step === "entry"
        ? "You'll save projects, sync your price book, and keep chat history and quotes in one place."
        : step === "password"
          ? "Google and email/password are separate sign-in methods."
          : null;

  const dialog = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4">
      <button
        type="button"
        aria-label="Close dialog backdrop"
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 my-auto w-full max-w-[400px] rounded-3xl bg-white px-6 pb-7 pt-5 shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50"
          aria-label="Close"
        >
          <X size={16} />
        </button>

        <div className="mx-auto max-w-[320px] pt-6 text-center">
          <h2
            id={titleId}
            className="text-[22px] font-semibold tracking-tight text-gray-900"
          >
            {title}
          </h2>
          {subtitle && (
            <p className="mt-2 text-sm leading-relaxed text-gray-500">
              {subtitle}
            </p>
          )}
        </div>

        <div className="mx-auto mt-6 max-w-[320px] space-y-3">
          {step === "welcome" ? (
            <>
              <ul className="space-y-2">
                {accounts.map((account) => {
                  const label = providerLabel(account.provider);
                  return (
                    <li key={account.email}>
                      <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-3 py-3">
                        <button
                          type="button"
                          onClick={() => chooseAccount(account)}
                          disabled={loading}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-60"
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-500 text-sm font-semibold text-white">
                            {accountInitials(account)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-gray-900">
                              {displayNameForAccount(account)}
                            </span>
                            <span className="block truncate text-xs text-gray-500">
                              {account.email}
                            </span>
                            {label && (
                              <span className="mt-0.5 block text-[11px] font-medium text-gray-400">
                                Continues with {label}
                              </span>
                            )}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveAccount(account)}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                          aria-label={`Remove ${account.email}`}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="flex items-center gap-3 py-1">
                <div className="h-px flex-1 bg-gray-200" />
                <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  OR
                </span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>

              <button
                type="button"
                onClick={() => {
                  setEmail("");
                  setPassword("");
                  setMode("signin");
                  setError(null);
                  setMessage(null);
                  setStep("entry");
                }}
                className="w-full rounded-full border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50"
              >
                Log in to another account
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmail("");
                  setPassword("");
                  setMode("signup");
                  setError(null);
                  setMessage(null);
                  setStep("entry");
                }}
                className="w-full rounded-full border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50"
              >
                Create account
              </button>
            </>
          ) : step === "entry" ? (
            <>
              <button
                type="button"
                disabled={loading}
                onClick={() => handleOAuth("google")}
                className="flex w-full items-center justify-center gap-3 rounded-full border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 disabled:opacity-60"
              >
                <GoogleIcon />
                {loading ? "Redirecting to Google..." : "Continue with Google"}
              </button>

              <div className="flex items-center gap-3 py-1">
                <div className="h-px flex-1 bg-gray-200" />
                <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  OR
                </span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>

              <form onSubmit={handlePasswordSubmit} className="space-y-3 text-left">
                <div>
                  <label
                    htmlFor="plg-auth-email"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Email
                  </label>
                  <input
                    id="plg-auth-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-full border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="plg-auth-password"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Password
                  </label>
                  <input
                    id="plg-auth-password"
                    type="password"
                    autoComplete={
                      mode === "signin" ? "current-password" : "new-password"
                    }
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-full border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-full bg-gray-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-black disabled:opacity-60"
                >
                  {loading
                    ? "Please wait…"
                    : mode === "signin"
                      ? "Log in"
                      : "Create account"}
                </button>
                {mode === "signin" && (
                  <p className="text-center">
                    <Link
                      href="/auth/forgot-password"
                      className="text-sm font-medium text-gray-600 hover:text-gray-900"
                      onClick={onClose}
                    >
                      Forgot password?
                    </Link>
                  </p>
                )}
                <p className="text-center text-sm text-gray-500">
                  {mode === "signin" ? (
                    <>
                      New here?{" "}
                      <button
                        type="button"
                        className="font-medium text-gray-900 underline"
                        onClick={() => {
                          setMode("signup");
                          setError(null);
                          setMessage(null);
                        }}
                      >
                        Sign up
                      </button>
                    </>
                  ) : (
                    <>
                      Already have an account?{" "}
                      <button
                        type="button"
                        className="font-medium text-gray-900 underline"
                        onClick={() => {
                          setMode("signin");
                          setError(null);
                          setMessage(null);
                        }}
                      >
                        Log in
                      </button>
                    </>
                  )}
                </p>
              </form>

              {accounts.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMessage(null);
                    setStep("welcome");
                  }}
                  className="w-full pt-1 text-center text-sm text-gray-500 hover:text-gray-800"
                >
                  ← Back to saved accounts
                </button>
              )}
            </>
          ) : (
            <div className="space-y-3 text-left">
              <button
                type="button"
                onClick={() => {
                  setPassword("");
                  setError(null);
                  setMessage(null);
                  setStep(accounts.length > 0 && mode === "signin" ? "welcome" : "entry");
                }}
                className="text-sm text-gray-500 hover:text-gray-800"
              >
                ← {email}
              </button>

              {/* Older remembered accounts may not know the provider yet — always offer Google. */}
              <button
                type="button"
                disabled={loading}
                onClick={() => handleOAuth("google")}
                className="flex w-full items-center justify-center gap-3 rounded-full border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 disabled:opacity-60"
              >
                <GoogleIcon />
                Continue with Google
              </button>

              <div className="flex items-center gap-3 py-1">
                <div className="h-px flex-1 bg-gray-200" />
                <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  OR
                </span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>

              <form onSubmit={handlePasswordSubmit} className="space-y-3">
                <input
                  type="password"
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  required
                  autoFocus
                  className="w-full rounded-full border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-full bg-gray-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-black disabled:opacity-60"
                >
                  {loading
                    ? "Please wait…"
                    : mode === "signin"
                      ? "Log in"
                      : "Create account"}
                </button>
                {mode === "signin" && (
                  <p className="text-center">
                    <Link
                      href="/auth/forgot-password"
                      className="text-sm font-medium text-gray-600 hover:text-gray-900"
                      onClick={onClose}
                    >
                      Forgot password?
                    </Link>
                  </p>
                )}
                <p className="text-center text-sm text-gray-500">
                  {mode === "signin" ? (
                    <>
                      New here?{" "}
                      <button
                        type="button"
                        className="font-medium text-gray-900 underline"
                        onClick={() => {
                          setMode("signup");
                          setError(null);
                          setMessage(null);
                        }}
                      >
                        Sign up
                      </button>
                    </>
                  ) : (
                    <>
                      Already have an account?{" "}
                      <button
                        type="button"
                        className="font-medium text-gray-900 underline"
                        onClick={() => {
                          setMode("signin");
                          setError(null);
                          setMessage(null);
                        }}
                      >
                        Log in
                      </button>
                    </>
                  )}
                </p>
              </form>
            </div>
          )}

          {error && (
            <p className="text-center text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="text-center text-sm text-gray-600">{message}</p>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
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
