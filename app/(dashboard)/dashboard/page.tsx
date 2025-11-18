"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, FileText } from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { trackProjectCreated } from "@/lib/analytics";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";

export default function DashboardPage() {
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [projectInputFocused, setProjectInputFocused] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const { createProject } = useProjects();
  const router = useRouter();
  const supabase = createClient();

  const sanitizeFileName = (name: string) => {
    const trimmed = name?.trim() || "untitled";
    return trimmed.replace(/[^a-zA-Z0-9.\-_ ]/g, "").replace(/\s+/g, "-");
  };

  useEffect(() => {
    const urls: Record<string, string> = {};
    selectedFiles.forEach((file) => {
      if (file.type.startsWith("image/")) {
        const key = `${file.name}-${file.lastModified}`;
        urls[key] = URL.createObjectURL(file);
      }
    });
    setPreviewUrls(urls);

    return () => {
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [selectedFiles]);

  const formatFileSize = (bytes: number) => {
    if (!Number.isFinite(bytes)) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleFilesSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setSelectedFiles((prev) => [...prev, ...Array.from(files)]);
    // Reset input value so the same file can be selected again if needed
    event.target.value = "";
  };

  const handleFileButtonClick = () => {
    fileInputRef.current?.click();
  };

  const removeSelectedFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, idx) => idx !== index));
  };

  const resetFileSelection = () => {
    setSelectedFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const uploadFilesToProject = async (projectId: string) => {
    if (selectedFiles.length === 0) return;

    const filesToUpload = [...selectedFiles];

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

      for (const file of filesToUpload) {
        const safeName = sanitizeFileName(file.name || "file");
        const storagePath = `${projectId}/initial-upload/${batchKey}-${safeName}`;

        try {
          const { error: uploadError } = await supabase.storage
            .from("project-files")
            .upload(storagePath, file, {
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
              file_name: file.name || safeName,
              file_type: file.type || "application/octet-stream",
              file_size: file.size,
              storage_path: storagePath,
              uploaded_by: user.id,
              folder_id: null,
            });

          if (dbError) {
            throw dbError;
          }

          successCount += 1;
        } catch (fileError: any) {
          failures.push(
            `${file.name || "File"}: ${
              fileError?.message || "Unable to upload"
            }`,
          );
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
    } catch (error: any) {
      toast.error(error?.message || "Failed to upload files to drive");
    } finally {
      setUploadingFiles(false);
      resetFileSelection();
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
        if (selectedFiles.length > 0) {
          await uploadFilesToProject(project.id);
        }
        await trackProjectCreated(project.id, project.project_name);
        toast.success("Project created!");
        // Force a router refresh to update the sidebar
        router.refresh();
        router.push(`/projects/${project.id}`);
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
            className={`bg-gray-100 rounded-2xl border ${
              projectInputFocused ? "border-gray-300" : "border-transparent"
            } transition-all`}
          >
            {selectedFiles.length > 0 && (
              <div className="px-4 pt-4 flex flex-wrap gap-3">
                {selectedFiles.map((file, index) => {
                  const previewKey = `${file.name}-${file.lastModified}`;
                  const previewUrl = previewUrls[previewKey];
                  return (
                  <div
                    key={`${file.name}-${file.size}-${index}`}
                    className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm max-w-full"
                  >
                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        alt={file.name}
                        className="w-10 h-10 rounded-md object-cover border border-gray-200"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-gray-100 flex items-center justify-center border border-gray-200">
                        <FileText size={18} className="text-gray-500" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {file.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSelectedFile(index)}
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
            )}
            <div className="flex items-center gap-3 px-4 py-3">
              <button
                type="button"
                onClick={handleFileButtonClick}
                className="p-2 rounded-full text-gray-500 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 transition"
                title="Attach files"
              >
                <Plus size={18} />
                <span className="sr-only">Attach files</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFilesSelected}
              />
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onKeyPress={handleKeyPress}
                onFocus={(event) => {
                  setProjectInputFocused(true);
                  // Select existing text to allow quick replacement
                  event.target.select();
                }}
                onBlur={() => {
                  if (!projectName.trim()) {
                    setProjectInputFocused(false);
                  }
                }}
                placeholder={projectInputFocused ? "" : "Project Name"}
                disabled={creating}
                className="flex-1 bg-transparent border-none text-lg placeholder-gray-400 focus:outline-none disabled:opacity-50 py-1"
              />
            </div>
          </div>
        </div>

        {/* Create Button */}
        <button
          onClick={handleCreateProject}
          disabled={!projectName.trim() || creating}
          className="w-full py-4 bg-gray-800 hover:bg-gray-900 text-white rounded-xl font-medium text-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-800"
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

