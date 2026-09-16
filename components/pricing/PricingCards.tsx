"use client";

import { useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { PLAN_PRICING } from "@/types/database";
import AuthPromptModal from "@/components/plg/AuthPromptModal";

type BillingCycle = "monthly" | "yearly";

export default function PricingCards({
  showAuthForFree = true,
  onFreeClick,
}: {
  showAuthForFree?: boolean;
  onFreeClick?: () => void;
}) {
  const [isYearly, setIsYearly] = useState(true);
  const [seatCount, setSeatCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  const billingCycle: BillingCycle = isYearly ? "yearly" : "monthly";
  const perSeatDisplay = isYearly
    ? PLAN_PRICING.pro.yearlyDisplayedMonthlyCents
    : PLAN_PRICING.pro.monthlyPerSeatCents;
  const totalDisplayMonthly = perSeatDisplay * seatCount;

  const format = (cents: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);

  const handleProCheckout = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billingCycle,
          seatCount,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to start checkout");
      }

      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (data.updated) {
        window.location.href = "/dashboard";
        return;
      }
      throw new Error("No checkout URL returned");
    } catch (err: any) {
      alert(err.message || "Checkout failed. Please try again.");
      setLoading(false);
    }
  };

  return (
    <>
      {showAuthForFree && (
        <AuthPromptModal open={authOpen} onClose={() => setAuthOpen(false)} />
      )}

      <div className="flex justify-center mb-10">
        <div className="inline-flex items-center gap-2 p-1 bg-gray-100 rounded-full">
          <button
            type="button"
            onClick={() => setIsYearly(false)}
            className={`px-5 py-2 rounded-full text-sm font-medium transition-colors ${
              !isYearly ? "bg-white shadow text-gray-900" : "text-gray-600"
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setIsYearly(true)}
            className={`px-5 py-2 rounded-full text-sm font-medium transition-colors ${
              isYearly ? "bg-white shadow text-gray-900" : "text-gray-600"
            }`}
          >
            Annual
            <span className="ml-2 inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-bold text-green-800">
              Save <span className="ml-1 text-sm font-extrabold text-green-700">20%</span>
            </span>
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        {/* Free */}
        <div className="rounded-2xl border border-gray-200 bg-white p-8 flex flex-col">
          <h2 className="text-2xl font-bold text-gray-900">Free</h2>
          <p className="text-gray-600 mt-2 text-sm">
            Everything you need to start quoting — 5 exports per month
          </p>
          <div className="mt-6 mb-6">
            <span className="text-5xl font-bold text-gray-900">$0</span>
          </div>
          <ul className="space-y-3 text-sm text-gray-700 flex-1 mb-8">
            {[
              "5 unique quote exports per month",
              "AI chat assistant",
              "Product library & price book",
              "Profit margin generation",
            ].map((f) => (
              <li key={f} className="flex gap-2">
                <Check className="w-5 h-5 text-green-600 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              if (onFreeClick) onFreeClick();
              else if (showAuthForFree) setAuthOpen(true);
              else window.location.href = "/";
            }}
            className="w-full py-3 rounded-lg border border-gray-300 font-medium text-gray-900 hover:bg-gray-50 transition-colors"
          >
            Start free
          </button>
        </div>

        {/* Pro */}
        <div className="rounded-2xl border-2 border-green-600 bg-white p-8 flex flex-col relative shadow-sm">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-green-600 text-white text-xs font-bold px-3 py-1 rounded-full">
            PRO
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Pro</h2>
          <p className="text-gray-600 mt-2 text-sm">
            Unlimited quoting for individuals and teams
          </p>
          <div className="mt-6 mb-6">
            {seatCount === 1 ? (
              <div className="flex items-baseline gap-1 flex-wrap">
                <span className="text-5xl font-bold text-gray-900">
                  {format(perSeatDisplay)}
                </span>
                <span className="text-gray-500 text-lg">/ user / month</span>
              </div>
            ) : (
              <div className="flex items-baseline gap-1 flex-wrap">
                <span className="text-5xl font-bold text-gray-900">
                  {format(totalDisplayMonthly)}
                </span>
                <span className="text-gray-500 text-lg">
                  /month for {seatCount} licenses
                </span>
              </div>
            )}
            {isYearly && (
              <p className="text-sm text-gray-500 mt-2">
                Billed {format(PLAN_PRICING.pro.yearlyPerSeatCents * seatCount)}
                /yr
                {seatCount > 1
                  ? ` for ${seatCount} licenses`
                  : ""}
              </p>
            )}
          </div>

          <div className="mb-6 p-3 bg-gray-50 rounded-lg">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Licenses
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSeatCount(Math.max(1, seatCount - 1))}
                disabled={seatCount <= 1}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-gray-200 hover:bg-gray-300 disabled:opacity-40"
                aria-label="Decrease licenses"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="flex-1 text-center text-xl font-semibold">{seatCount}</span>
              <button
                type="button"
                onClick={() => setSeatCount(seatCount + 1)}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-gray-200 hover:bg-gray-300"
                aria-label="Increase licenses"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              1 license for yourself · Add licenses for your team
            </p>
          </div>

          <ul className="space-y-3 text-sm text-gray-700 flex-1 mb-8">
            {[
              "Everything in Free",
              "Unlimited quote exports",
              "Invite teammates up to your license count",
              "Shared price book & collaboration",
              "Priority support",
            ].map((f) => (
              <li key={f} className="flex gap-2">
                <Check className="w-5 h-5 text-green-600 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={loading}
            onClick={handleProCheckout}
            className="w-full py-3 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium transition-colors disabled:opacity-60"
          >
            {loading ? "Starting checkout…" : "Upgrade to Pro"}
          </button>
        </div>
      </div>

    </>
  );
}
