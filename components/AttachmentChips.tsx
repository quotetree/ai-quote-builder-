"use client";

import { AttachmentItem, AttachmentStatus } from "@/hooks/useAttachmentManager";
import { FileText, Loader2, CheckCircle, AlertCircle, X } from "lucide-react";

interface AttachmentChipsProps {
  attachments: AttachmentItem[];
  onRemove: (id: string) => void;
  formatFileSize: (bytes: number) => string;
}

const statusStyles: Record<
  AttachmentStatus,
  { text: string; className: string }
> = {
  pending: { text: "Pending", className: "text-gray-500" },
  uploading: { text: "Uploading…", className: "text-green-600" },
  uploaded: { text: "Uploaded", className: "text-emerald-600" },
  error: { text: "Failed", className: "text-red-600" },
};

export function AttachmentChips({
  attachments,
  onRemove,
  formatFileSize,
}: AttachmentChipsProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="px-4 pt-4 pb-3 flex flex-wrap gap-3">
      {attachments.map((attachment) => {
        const statusConfig = statusStyles[attachment.status];

        return (
          <div
            key={attachment.id}
            className="flex items-start gap-3 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm max-w-full relative"
          >
            {attachment.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={attachment.previewUrl}
                alt={attachment.file.name}
                className="w-10 h-10 rounded-md object-cover border border-gray-200"
              />
            ) : (
              <div className="w-10 h-10 rounded-md bg-gray-100 flex items-center justify-center border border-gray-200">
                <FileText size={18} className="text-gray-500" />
              </div>
            )}

            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">
                {attachment.file.name}
              </p>
              <p className="text-xs text-gray-500">{formatFileSize(attachment.file.size)}</p>
              <div className="mt-1 flex items-center gap-1 text-xs">
                {attachment.status === "uploading" && (
                  <Loader2 size={12} className="animate-spin text-green-600" />
                )}
                {attachment.status === "uploaded" && (
                  <CheckCircle size={12} className="text-emerald-600" />
                )}
                {attachment.status === "error" && (
                  <AlertCircle size={12} className="text-red-600" />
                )}
                <span className={statusConfig.className}>{statusConfig.text}</span>
              </div>
              {attachment.error && (
                <p className="text-xs text-red-600 mt-1">{attachment.error}</p>
              )}
            </div>

            <button
              type="button"
              onClick={() => onRemove(attachment.id)}
              className="text-gray-400 hover:text-red-500 transition"
              title="Remove file"
            >
              <X size={14} />
              <span className="sr-only">Remove file</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

