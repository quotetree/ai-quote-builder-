"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
  const { createProject } = useProjects();
  const router = useRouter();
  const supabase = createClient();

  const sanitizeFileName = (name: string) => {
    const trimmed = name?.trim() || "untitled";
    return trimmed.replace(/[^a-zA-Z0-9.\-_ ]/g, "").replace(/\s+/g, "-");
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

      for (const file of selectedFiles) {
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
          <div className="relative">
            <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
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
            </div>
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
              className="w-full pl-14 pr-4 py-4 bg-gray-100 rounded-xl text-lg placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300 transition-all disabled:opacity-50"
            />
          </div>
          {selectedFiles.length > 0 && (
            <div className="mt-4 bg-gray-50 border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">
                  Files to upload ({selectedFiles.length})
                </p>
                <button
                  type="button"
                  onClick={resetFileSelection}
                  className="text-xs text-gray-500 hover:text-red-500 transition"
                >
                  Clear all
                </button>
              </div>
              <ul className="space-y-1 max-h-40 overflow-y-auto text-sm text-gray-700">
                {selectedFiles.map((file, index) => (
                  <li
                    key={`${file.name}-${file.size}-${index}`}
                    className="flex items-center justify-between gap-4"
                  >
                    <span className="truncate">{file.name}</span>
                    <button
                      type="button"
                      className="text-xs text-gray-500 hover:text-red-500 transition"
                      onClick={() => removeSelectedFile(index)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
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

