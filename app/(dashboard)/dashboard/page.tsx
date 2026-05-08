"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { trackProjectCreated } from "@/lib/analytics";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import {
  useAttachmentManager,
  AttachmentItem,
} from "@/hooks/useAttachmentManager";
import { AttachmentChips } from "@/components/AttachmentChips";

export default function DashboardPage() {
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [projectInputFocused, setProjectInputFocused] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const searchParams = useSearchParams();
  const {
    attachments,
    fileInputRef,
    openFilePicker,
    handleFileInputChange,
    removeAttachment,
    clearAttachments,
    setAttachmentStatus,
  } = useAttachmentManager();
  const { createProject } = useProjects();
  const router = useRouter();
  const supabase = createClient();

  // Handle Stripe redirect
  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    const plan = searchParams.get("plan");
    
    if (sessionId) {
      // Show success message
      toast.success(
        `🎉 Payment successful! Your ${plan === "individual" ? "Individual" : "Organization"} plan is now active.`,
        { duration: 5000 }
      );
      
      // Clean up URL
      router.replace("/dashboard");
    }
  }, [searchParams, router]);

  const sanitizeFileName = (name: string) => {
    const trimmed = name?.trim() || "untitled";
    return trimmed.replace(/[^a-zA-Z0-9.\-_ ]/g, "").replace(/\s+/g, "-");
  };

  const formatFileSize = (bytes: number) => {
    if (!Number.isFinite(bytes)) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const uploadFilesToProject = async (projectId: string) => {
    if (attachments.length === 0) {
      return { successCount: 0, failureCount: 0 };
    }

    const filesToUpload: AttachmentItem[] = attachments.map((attachment) => ({
      ...attachment,
    }));

    setUploadingFiles(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error("You must be signed in to upload files");
      }

      const batchKey = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      let successCount = 0;
      const failures: string[] = [];

      for (const attachment of filesToUpload) {
        const safeName = sanitizeFileName(attachment.file.name || "file");
        const uniqueId =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const storagePath = `project-${projectId}/${uniqueId}-${safeName}`;

        setAttachmentStatus(attachment.id, "uploading");

        try {
          const { error: uploadError } = await supabase.storage
            .from("project-files")
            .upload(storagePath, attachment.file, {
              cacheControl: "3600",
              upsert: false,
            });

          if (uploadError) {
            throw uploadError;
          }

          const { error: dbError } = await supabase
            .from("project_documents")
            .insert({
              project_id: projectId,
              file_name: attachment.file.name || safeName,
              file_type: attachment.file.type || "application/octet-stream",
              file_size: attachment.file.size,
              storage_path: storagePath,
              uploaded_by: user.id,
              folder_id: null,
            });

          if (dbError) {
            throw dbError;
          }

          setAttachmentStatus(attachment.id, "uploaded");
          successCount += 1;
        } catch (fileError: any) {
          const message = fileError?.message || "Unable to upload";
          failures.push(`${attachment.file.name || "File"}: ${message}`);
          setAttachmentStatus(attachment.id, "error", message);
          console.error("Failed to upload file", fileError);
        }
      }

      if (successCount > 0) {
        toast.success(
          `Uploaded ${successCount} file${successCount === 1 ? "" : "s"} to drive`,
        );
      }

      if (failures.length > 0) {
        toast.error(
          `Failed to upload ${failures.length} file${
            failures.length === 1 ? "" : "s"
          }`,
        );
      }

      if (failures.length === 0) {
        clearAttachments();
      }

      return { successCount, failureCount: failures.length };
    } catch (error: any) {
      toast.error(error?.message || "Failed to upload files to drive");
      return { successCount: 0, failureCount: attachments.length };
    } finally {
      setUploadingFiles(false);
    }
  };

  const handleCreateProject = async () => {
    if (!projectName.trim()) {
      toast.error("Please enter a project name");
      return;
    }

    setCreating(true);
    try {
      const project = await createProject(projectName.trim(), []);
      if (project) {
        const { failureCount } = await uploadFilesToProject(project.id);
        await trackProjectCreated(project.id, project.project_name);
        if (failureCount === 0) {
          toast.success("Project created!");
        } else {
          toast.error("Project created but some files failed to upload");
        }
        router.push(`/projects/${project.id}`);
        // Notify sidebar to refresh project list without blocking navigation
        window.dispatchEvent(new CustomEvent("projectUpdated"));
        setProjectName("");
        setProjectInputFocused(false);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && projectName.trim()) {
      handleCreateProject();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-full max-w-2xl px-8">
        {/* Main Content */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-semibold mb-4">New project</h1>
          <p className="text-gray-500">
            Projects keep your chat history, product selections, and quotes all in one place.
          </p>
        </div>

        {/* Project Name Input */}
        <div className="mb-8">
          <div
            className={`bg-gray-100 rounded-xl border ${
              projectInputFocused ? "border-gray-300" : "border-transparent"
            } transition-all`}
          >
            {/* Attachment Chips */}
            <AttachmentChips
              attachments={attachments}
              onRemove={removeAttachment}
              formatFileSize={formatFileSize}
            />
            
            {/* Input Row */}
            <div className="relative">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileInputChange}
                aria-label="Attach files"
              />
              <button
                type="button"
                onClick={openFilePicker}
                className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                title="Attach files"
              >
                <Plus size={20} />
              </button>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onKeyPress={handleKeyPress}
                onFocus={(event) => {
                  setProjectInputFocused(true);
                  event.target.select();
                }}
                onBlur={() => {
                  if (!projectName.trim()) {
                    setProjectInputFocused(false);
                  }
                }}
                placeholder={projectInputFocused ? "" : "Project Name"}
                disabled={creating}
                className="w-full pl-12 pr-4 py-4 bg-transparent rounded-xl text-lg placeholder-gray-400 focus:outline-none focus:ring-0 disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        {/* Create Button */}
        <button
          onClick={handleCreateProject}
          disabled={!projectName.trim() || creating}
          className={`w-full py-4 text-white rounded-xl font-medium text-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            projectName.trim() && !creating
              ? "bg-brand-green hover:bg-brand-green-dark"
              : "bg-gray-800 hover:bg-gray-900 disabled:hover:bg-gray-800"
          }`}
        >
          {creating
            ? uploadingFiles
              ? "Uploading files..."
              : "Creating..."
            : "Create project"}
        </button>
      </div>
    </div>
  );
}

