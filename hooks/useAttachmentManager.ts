"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AttachmentStatus = "pending" | "uploading" | "uploaded" | "error";

export interface AttachmentItem {
  id: string;
  file: File;
  previewUrl?: string;
  status: AttachmentStatus;
  error?: string;
}

export interface UseAttachmentManagerResult {
  attachments: AttachmentItem[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  openFilePicker: () => void;
  handleFileInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  setAttachmentStatus: (
    id: string,
    status: AttachmentStatus,
    error?: string,
  ) => void;
}

const createAttachmentItem = (file: File): AttachmentItem => {
  const supportsPreview = typeof window !== "undefined" && file.type.startsWith("image/");
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    file,
    previewUrl: supportsPreview ? URL.createObjectURL(file) : undefined,
    status: "pending",
  };
};

export function useAttachmentManager(): UseAttachmentManagerResult {
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Clean up object URLs
  useEffect(() => {
    return () => {
      attachments.forEach((attachment) => {
        if (attachment.previewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      });
    };
  }, [attachments]);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files;
      if (!fileList || fileList.length === 0) return;

      const newAttachments = Array.from(fileList).map((file) =>
        createAttachmentItem(file),
      );

      setAttachments((prev) => [...prev, ...newAttachments]);

      // allow re-selecting same files
      event.target.value = "";
    },
    [],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((attachment) => attachment.id === id);
      if (target?.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((attachment) => attachment.id !== id);
    });
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments((prev) => {
      prev.forEach((attachment) => {
        if (attachment.previewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      });
      return [];
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const setAttachmentStatus = useCallback(
    (id: string, status: AttachmentStatus, error?: string) => {
      setAttachments((prev) =>
        prev.map((attachment) =>
          attachment.id === id ? { ...attachment, status, error } : attachment,
        ),
      );
    },
    [],
  );

  return {
    attachments,
    fileInputRef,
    openFilePicker,
    handleFileInputChange,
    removeAttachment,
    clearAttachments,
    setAttachmentStatus,
  };
}

