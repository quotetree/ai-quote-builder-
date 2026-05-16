"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, Clock, Copy, ExternalLink, Link2, Loader2, RefreshCw, X } from "lucide-react";
import {
  ELEMENT_LABELS,
  ProposalRecipient,
  ProposalSignatureStatus,
  TemplatePage,
} from "./proposalTemplateTypes";

const SIGNING_FIELD_TYPES = new Set(["signature", "initial", "date", "checkbox"]);

/**
 * Returns a list of human-readable problem strings for any signing field
 * that has no signer assigned. Empty array means all fields are good.
 */
function findUnassignedFields(
  pages: TemplatePage[],
  signers: ProposalRecipient[]
): string[] {
  const signerEmails = new Set(signers.map((s) => s.email.toLowerCase()));
  const problems: string[] = [];
  for (let pi = 0; pi < pages.length; pi++) {
    for (const el of pages[pi].elements) {
      if (!SIGNING_FIELD_TYPES.has(el.type)) continue;
      // Executed fields (already filled by the sender) don't need a signer assignment
      if (el.content && el.content.length > 0) continue;
      const email = (el.variableName ?? "").trim().toLowerCase();
      if (!email) {
        problems.push(`Page ${pi + 1}: ${ELEMENT_LABELS[el.type] ?? el.type}`);
      } else if (!signerEmails.has(email)) {
        problems.push(`Page ${pi + 1}: ${ELEMENT_LABELS[el.type] ?? el.type} (unknown recipient)`);
      }
    }
  }
  return problems;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SignerLink {
  email: string;
  name: string;
  firma_user_id: string;
  signing_url: string;
  signed_at?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  quoteId: string;
  quoteName?: string;
  recipients: ProposalRecipient[];
  /** Current proposal pages — used for client-side field-assignment validation. */
  pages?: TemplatePage[];
  /**
   * Pre-existing signer links loaded from DB.
   * When provided the modal displays them immediately without generating a new request.
   */
  existingLinks?: SignerLink[];
  /**
   * The current signature status from the parent (loaded from DB).
   * Used to show the correct status badge when displaying existing links.
   */
  currentSignatureStatus?: ProposalSignatureStatus | null;
  /** Called when links have been generated so parent can refresh status and links */
  onLinksGenerated?: (status: ProposalSignatureStatus, links?: SignerLink[]) => void;
  /**
   * Called when the modal opens or when the user hits "Refresh status".
   * The parent should call /api/firma/sync-status and update existingLinks + currentSignatureStatus.
   */
  onRefreshStatus?: () => void;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ProposalSignatureStatus }) {
  const map: Record<ProposalSignatureStatus, { label: string; cls: string }> = {
    draft:     { label: "Draft",     cls: "bg-gray-100 text-gray-600" },
    sent:      { label: "Sent",      cls: "bg-blue-100 text-blue-700" },
    viewed:    { label: "Viewed",    cls: "bg-yellow-100 text-yellow-700" },
    completed: { label: "Completed", cls: "bg-green-100 text-green-700" },
    declined:  { label: "Declined",  cls: "bg-red-100 text-red-700" },
    expired:   { label: "Expired",   cls: "bg-gray-100 text-gray-500" },
    failed:    { label: "Failed",    cls: "bg-red-50 text-red-500" },
  };
  const { label, cls } = map[status] ?? map.draft;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

// ─── Copy Button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };
  return (
    <button
      onClick={handleCopy}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
        copied
          ? "bg-green-100 text-green-700"
          : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
      }`}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export default function ProposalShareLinkModal({
  isOpen, onClose, quoteId, quoteName, recipients, pages, existingLinks,
  currentSignatureStatus, onLinksGenerated, onRefreshStatus,
}: Props) {
  const [generating, setGenerating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signerLinks, setSignerLinks] = useState<SignerLink[]>([]);
  const [currentStatus, setCurrentStatus] = useState<ProposalSignatureStatus | null>(null);
  // Track whether we've already triggered the initial refresh for this open session
  const hasTriggeredRefreshRef = useRef(false);

  const signers = recipients.filter((r) => r.role === "signer");
  const hasRecipients = signers.length > 0;

  // On open: populate from existingLinks and trigger an immediate status refresh so
  // any signatures that happened since the last poll are picked up right away.
  useEffect(() => {
    if (isOpen) {
      setError(null);
      hasTriggeredRefreshRef.current = false;
    } else {
      hasTriggeredRefreshRef.current = false;
    }
  }, [isOpen]);

  // Keep signerLinks and status badge in sync with parent whenever existingLinks
  // or currentSignatureStatus change (covers both initial open and live poll updates).
  useEffect(() => {
    if (!isOpen) return;
    if (existingLinks && existingLinks.length > 0) {
      setSignerLinks(existingLinks);
      setCurrentStatus((prev) => currentSignatureStatus ?? prev ?? "sent");
    } else if (existingLinks && existingLinks.length === 0) {
      // Links were cleared (e.g. after re-generate) — let the generate flow handle it
    }
  // We intentionally track the array reference; shallow-equal is fine here since
  // the parent always creates a new array reference when all_signers_data changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingLinks, currentSignatureStatus, isOpen]);

  // Trigger an immediate sync-status check the first time the modal opens for a
  // signing request that is already in "sent" or "viewed" state, so the user sees
  // fresh data without waiting up to 20 s for the next background poll.
  useEffect(() => {
    if (!isOpen || hasTriggeredRefreshRef.current) return;
    if (existingLinks && existingLinks.length > 0 && onRefreshStatus) {
      hasTriggeredRefreshRef.current = true;
      onRefreshStatus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, existingLinks]);

  const handleRefresh = async () => {
    if (!onRefreshStatus) return;
    setRefreshing(true);
    try {
      await new Promise<void>((resolve) => {
        onRefreshStatus();
        // Give the parent ~2 s to fetch and propagate the update
        setTimeout(resolve, 2000);
      });
    } finally {
      setRefreshing(false);
    }
  };

  const handleGenerate = async () => {
    if (!hasRecipients) return;
    setError(null);

    // Client-side pre-flight: every signing field must have an explicit signer.
    if (pages && pages.length > 0) {
      const problems = findUnassignedFields(pages, signers);
      if (problems.length > 0) {
        setError(
          `Assign a signer to every signing field before generating links.\n\nUnassigned fields:\n` +
          problems.map((p) => `• ${p}`).join("\n")
        );
        return;
      }
    }

    setGenerating(true);

    try {
      const res = await fetch("/api/firma/create-signing-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId, quoteName }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to generate signing links. Please try again.");
        return;
      }

      const newLinks: SignerLink[] = data.signer_links ?? [];
      setSignerLinks(newLinks);
      setCurrentStatus("sent");
      onLinksGenerated?.("sent", newLinks);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error. Please try again.";
      setError(msg);
    } finally {
      setGenerating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <Link2 size={16} className="text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Share link</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Status banner (after generation) */}
          {currentStatus && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Document status:</span>
              <StatusBadge status={currentStatus} />
            </div>
          )}

          {signerLinks.length === 0 ? (
            /* Pre-generation state */
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
                <Link2 size={18} className="text-gray-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    Generate links to share the document
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Once links are generated, the document will be in{" "}
                    <strong>Sent</strong> status. Firma will email each signer automatically.
                  </p>
                </div>
              </div>

              {!hasRecipients && (
                <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-xs text-yellow-700 dark:text-yellow-400">
                  Add at least one <strong>Signer</strong> in the Recipients tab before generating links.
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-400 whitespace-pre-line">
                  {error}
                </div>
              )}

              {/* Recipients preview */}
              {hasRecipients && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Recipients ({recipients.length})
                  </p>
                  {recipients.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-bold">
                        {(r.first_name[0] ?? "") + (r.last_name?.[0] ?? "")}
                      </div>
                      <span className="truncate">{r.first_name} {r.last_name}</span>
                      <span className={`text-xs font-medium ml-auto flex-shrink-0 ${r.role === "signer" ? "text-red-500" : "text-gray-400"}`}>
                        {r.role === "signer" ? "Signer" : "CC"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={handleGenerate}
                disabled={!hasRecipients || generating}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {generating ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    Generating PDF & sending…
                  </>
                ) : (
                  <>
                    <Link2 size={15} />
                    Generate links
                  </>
                )}
              </button>
            </div>
          ) : (
            /* Post-generation state */
            <div className="space-y-4">
              {(() => {
                const signedCount = signerLinks.filter((l) => l.signed_at).length;
                const totalCount  = signerLinks.length;
                const allSigned   = signedCount === totalCount && totalCount > 0;
                const someSigned  = signedCount > 0 && !allSigned;
                return (
                  <div className={`p-3 border rounded-lg text-xs ${allSigned ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400" : someSigned ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400" : "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400"}`}>
                    {allSigned
                      ? `✓ All ${totalCount} signer${totalCount !== 1 ? "s" : ""} have signed.`
                      : someSigned
                        ? `${signedCount} of ${totalCount} signer${totalCount !== 1 ? "s" : ""} ${signedCount === 1 ? "has" : "have"} signed — waiting for the remaining ${totalCount - signedCount}.`
                        : "✓ Links generated. Firma has emailed each signer. You can also share the links below manually."}
                  </div>
                );
              })()}

              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                  Individual Links
                </p>
                <p className="text-xs text-gray-400 mb-3">
                  Links are unique for each recipient. Make sure the intended recipients are the only ones accessing their link.
                </p>
                <div className="space-y-3">
                  {signerLinks.map((link) => {
                    const hasSigned = !!link.signed_at;
                    return (
                      <div key={link.firma_user_id} className={`rounded-lg border p-3 ${hasSigned ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20" : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/50"}`}>
                        <div className="flex items-center gap-2 mb-1.5">
                          {hasSigned ? (
                            <CheckCircle2 size={15} className="text-green-600 dark:text-green-400 flex-shrink-0" />
                          ) : (
                            <Clock size={15} className="text-amber-500 flex-shrink-0" />
                          )}
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate flex-1">
                            {link.name}
                          </p>
                          <span className={`text-xs font-semibold flex-shrink-0 ${hasSigned ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                            {hasSigned ? "Signed" : "Pending"}
                          </span>
                        </div>
                        {hasSigned ? (
                          <p className="text-xs text-green-600 dark:text-green-400 pl-5">
                            Signed {new Date(link.signed_at!).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                          </p>
                        ) : (
                          <div className="flex items-center gap-2 pl-5">
                            <a
                              href={link.signing_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-500 hover:underline flex items-center gap-0.5 truncate flex-1"
                            >
                              {link.signing_url.replace("https://", "").slice(0, 38)}…
                              <ExternalLink size={10} className="flex-shrink-0" />
                            </a>
                            <CopyButton text={link.signing_url} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-2">
                {onRefreshStatus && (
                  <button
                    onClick={handleRefresh}
                    disabled={refreshing || generating}
                    className="flex-1 flex items-center justify-center gap-2 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                    title="Check Firma for the latest signing status"
                  >
                    {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    Refresh status
                  </button>
                )}
                <button
                  onClick={handleGenerate}
                  disabled={generating || refreshing}
                  className="flex-1 flex items-center justify-center gap-2 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  {generating ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                  Re-generate links
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
