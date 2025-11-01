"use client";

import { useState, useEffect } from "react";
import { Upload, File, Trash2, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ProjectDocument } from "@/types/database";
import toast from "react-hot-toast";

interface DrivePanelProps {
  projectId: string;
}

export default function DrivePanel({ projectId }: DrivePanelProps) {
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    loadDocuments();
  }, [projectId]);

  async function loadDocuments() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("project_documents")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setDocuments(data || []);
    } catch (error: any) {
      toast.error("Failed to load documents");
    } finally {
      setLoading(false);
    }
  }

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    const file = files[0];

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Upload to Supabase Storage
      const fileExt = file.name.split(".").pop();
      const fileName = `${projectId}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from("project-files")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // Create document record
      const { data, error: dbError } = await supabase
        .from("project_documents")
        .insert({
          project_id: projectId,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
          storage_path: fileName,
          uploaded_by: user.id,
        })
        .select()
        .single();

      if (dbError) throw dbError;
      if (data) {
        setDocuments([data, ...documents]);
        toast.success("File uploaded successfully");
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to upload file");
    } finally {
      setUploading(false);
      // Reset input
      event.target.value = "";
    }
  }

  async function handleDelete(doc: ProjectDocument) {
    if (!confirm(`Delete ${doc.file_name}?`)) return;

    try {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from("project-files")
        .remove([doc.storage_path]);

      if (storageError) throw storageError;

      // Delete from database
      const { error: dbError } = await supabase
        .from("project_documents")
        .delete()
        .eq("id", doc.id);

      if (dbError) throw dbError;

      setDocuments(documents.filter((d) => d.id !== doc.id));
      toast.success("File deleted");
    } catch (error: any) {
      toast.error("Failed to delete file");
    }
  }

  async function handleDownload(doc: ProjectDocument) {
    try {
      const { data, error } = await supabase.storage
        .from("project-files")
        .download(doc.storage_path);

      if (error) throw error;

      // Create download link
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.file_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast.error("Failed to download file");
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-500">Loading documents...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-gray-50 dark:bg-gray-950 p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Project Documents</h2>
        <label
          className={`px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors cursor-pointer inline-flex items-center gap-2 ${
            uploading ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          <Upload size={18} />
          <span>{uploading ? "Uploading..." : "Upload File"}</span>
          <input
            type="file"
            onChange={handleFileUpload}
            disabled={uploading}
            className="hidden"
          />
        </label>
      </div>

      {/* Documents List */}
      {documents.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-900 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700">
          <File size={48} className="mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600 dark:text-gray-400 mb-2">
            No documents uploaded yet
          </p>
          <p className="text-sm text-gray-500">
            Upload project files, images, or documents to reference while building quotes
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:shadow-lg transition-shadow"
            >
              <div className="flex items-start gap-3">
                <File size={24} className="text-blue-600 flex-shrink-0 mt-1" />
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium truncate">{doc.file_name}</h3>
                  <p className="text-sm text-gray-500">
                    {formatFileSize(doc.file_size)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(doc.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => handleDownload(doc)}
                  className="flex-1 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors text-sm flex items-center justify-center gap-2"
                >
                  <Download size={16} />
                  Download
                </button>
                <button
                  onClick={() => handleDelete(doc)}
                  className="px-3 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

