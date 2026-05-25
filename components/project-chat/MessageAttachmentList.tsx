"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export interface MessageAttachmentMeta {
  id: string;
  file_name: string;
  mime_type: string;
  storage_path?: string;
}

interface MessageAttachmentListProps {
  attachments: MessageAttachmentMeta[];
  /** User messages use compact chips above the bubble */
  variant?: "composer" | "message";
}

function isImageMime(mime: string): boolean {
  return mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(mime);
}

export default function MessageAttachmentList({
  attachments,
  variant = "message",
}: MessageAttachmentListProps) {
  const supabase = createClient();
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{
    file_name: string;
    url: string;
    mime_type: string;
  } | null>(null);

  const resolveSignedUrl = useCallback(
    async (att: MessageAttachmentMeta): Promise<string | null> => {
      let storagePath = att.storage_path;
      if (!storagePath) {
        const { data } = await supabase
          .from("chat_attachments")
          .select("storage_path")
          .eq("id", att.id)
          .single();
        storagePath = data?.storage_path ?? undefined;
      }
      if (!storagePath) return null;

      const { data, error } = await supabase.storage
        .from("project-files")
        .createSignedUrl(storagePath, 60 * 60);

      if (error || !data?.signedUrl) return null;
      return data.signedUrl;
    },
    [supabase],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const next: Record<string, string> = {};
      for (const att of attachments) {
        if (!isImageMime(att.mime_type)) continue;
        const url = await resolveSignedUrl(att);
        if (url && !cancelled) next[att.id] = url;
      }
      if (!cancelled) setThumbUrls(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [attachments, resolveSignedUrl]);

  const openPreview = async (att: MessageAttachmentMeta) => {
    const url = thumbUrls[att.id] ?? (await resolveSignedUrl(att));
    if (!url) return;
    setPreview({ file_name: att.file_name, url, mime_type: att.mime_type });
  };

  if (attachments.length === 0) return null;

  const chipClass =
    variant === "composer"
      ? "bg-white border-gray-200 shadow-sm"
      : "bg-white/95 border-gray-200 shadow-sm";

  return (
    <>
      <div
        className={`flex flex-wrap gap-2 ${variant === "message" ? "justify-end mb-1.5" : ""}`}
      >
        {attachments.map((att) => {
          const thumb = thumbUrls[att.id];
          const isImage = isImageMime(att.mime_type);

          return (
            <button
              key={att.id}
              type="button"
              onClick={() => void openPreview(att)}
              className={`inline-flex items-center gap-2 border rounded-lg pl-1 pr-2 py-1 max-w-full text-left hover:border-green-600 transition ${chipClass}`}
              title={`Preview ${att.file_name}`}
            >
              {isImage && thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumb}
                  alt={att.file_name}
                  className="w-9 h-9 rounded object-cover border border-gray-100 shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded bg-gray-100 flex items-center justify-center border border-gray-100 shrink-0">
                  <FileText size={16} className="text-gray-500" />
                </div>
              )}
              <span className="text-xs font-medium text-gray-800 truncate max-w-[140px]">
                {att.file_name}
              </span>
            </button>
          );
        })}
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Preview ${preview.file_name}`}
          onClick={() => setPreview(null)}
        >
          <div
            className="relative max-w-[min(96vw,900px)] max-h-[90vh] bg-white rounded-xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-gray-200">
              <p className="text-sm font-medium text-gray-900 truncate">{preview.file_name}</p>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="text-gray-500 hover:text-gray-800 shrink-0"
                aria-label="Close preview"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-3 overflow-auto max-h-[calc(90vh-48px)] flex items-center justify-center bg-gray-50">
              {isImageMime(preview.mime_type) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview.url}
                  alt={preview.file_name}
                  className="max-w-full max-h-[calc(90vh-80px)] object-contain rounded"
                />
              ) : (
                <iframe
                  src={preview.url}
                  title={preview.file_name}
                  className="w-full min-h-[60vh] rounded border border-gray-200 bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
