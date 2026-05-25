"use client";

import { FileText, Loader2, X } from "lucide-react";

export type PlanAttachmentPhase =
  | "local"
  | "uploading"
  | "processing"
  | "ready"
  | "error";

export interface PlanAttachmentChip {
  clientId: string;
  serverId?: string;
  file_name: string;
  mime_type: string;
  previewUrl?: string;
  phase: PlanAttachmentPhase;
  parse_error?: string | null;
}

interface PlanAttachmentChipsProps {
  attachments: PlanAttachmentChip[];
  onRemove: (clientId: string) => void;
}

const phaseLabel: Record<PlanAttachmentPhase, string> = {
  local: "ready",
  uploading: "uploading",
  processing: "uploading",
  ready: "ready",
  error: "failed",
};

export default function PlanAttachmentChips({
  attachments,
  onRemove,
}: PlanAttachmentChipsProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((att) => {
        const busy = att.phase === "uploading";

        return (
          <div
            key={att.clientId}
            className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-lg pl-1 pr-2 py-1 shadow-sm max-w-full"
            title={att.parse_error ?? undefined}
          >
            {att.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={att.previewUrl}
                alt={att.file_name}
                className="w-9 h-9 rounded object-cover border border-gray-100 shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded bg-gray-100 flex items-center justify-center border border-gray-100 shrink-0">
                <FileText size={16} className="text-gray-500" />
              </div>
            )}

            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-800 truncate max-w-[120px]">
                {att.file_name}
              </p>
              <p
                className={`text-[10px] leading-tight ${
                  att.phase === "ready"
                    ? "text-green-700"
                    : att.phase === "error"
                      ? "text-amber-700"
                      : "text-gray-500"
                }`}
              >
                {busy && <Loader2 size={10} className="inline animate-spin mr-0.5" />}
                {phaseLabel[att.phase]}
              </p>
            </div>

            <button
              type="button"
              onClick={() => onRemove(att.clientId)}
              className="text-gray-400 hover:text-gray-700 shrink-0"
              aria-label={`Remove ${att.file_name}`}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
