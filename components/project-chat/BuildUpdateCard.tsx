"use client";

import { Check, Loader2 } from "lucide-react";
import type { BuildUpdateProposal } from "@/lib/applyBuildUpdates";

interface BuildUpdateCardProps {
  proposal: BuildUpdateProposal;
  applied?: boolean;
  applying?: boolean;
  onApply: (proposal: BuildUpdateProposal) => Promise<void>;
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatValue(field: string, value: number) {
  if (field === "sales price") return fmt(value);
  if (field === "discount %") return `${value}%`;
  return String(value);
}

export default function BuildUpdateCard({
  proposal,
  applied = false,
  applying = false,
  onApply,
}: BuildUpdateCardProps) {
  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/80 px-3 py-3 flex gap-3 items-start">
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-sm font-semibold text-gray-900 leading-snug">{proposal.productName}</p>
        <p className="text-xs text-gray-600">
          {proposal.sectionLabel}
          {proposal.customLabel ? ` · ${proposal.customLabel}` : ""}
        </p>
        <p className="text-xs text-gray-700">
          {proposal.field}: {formatValue(proposal.field, proposal.oldValue)} →{" "}
          <span className="font-semibold">{formatValue(proposal.field, proposal.newValue)}</span>
        </p>
      </div>

      <button
        type="button"
        onClick={() => void onApply(proposal)}
        disabled={applied || applying}
        className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
      >
        {applying ? (
          <Loader2 size={14} className="animate-spin" />
        ) : applied ? (
          <Check size={14} />
        ) : null}
        {applied ? "Applied" : "Apply Change"}
      </button>
    </div>
  );
}
