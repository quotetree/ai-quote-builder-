"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function OnboardingBanner() {
  const [visible, setVisible] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      setUserId(user.id);

      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed_at")
        .eq("id", user.id)
        .maybeSingle();

      if (!cancelled && !profile?.onboarding_completed_at) {
        setVisible(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const completeOnboarding = async () => {
    if (!userId) {
      setVisible(false);
      return;
    }
    await supabase
      .from("profiles")
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq("id", userId);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="mb-8 rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            Welcome to QuoteTree
          </p>
          <p className="mt-1 text-sm text-gray-600 leading-relaxed">
            Create a project, chat about your scope, generate a quote, then
            export a QuoteTree PDF. Free plans include 5 unique quote exports
            per month.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void completeOnboarding()}
          className="rounded-lg p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
          aria-label="Dismiss onboarding"
        >
          <X size={18} />
        </button>
      </div>
      <button
        type="button"
        onClick={() => void completeOnboarding()}
        className="mt-3 text-sm font-medium text-brand-green hover:underline"
      >
        Got it
      </button>
    </div>
  );
}

/** Mark onboarding complete (e.g. after first project create). */
export async function markOnboardingComplete() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("profiles")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", user.id)
    .is("onboarding_completed_at", null);
}
