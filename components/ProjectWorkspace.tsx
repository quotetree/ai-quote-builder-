"use client";

import { useState, useEffect, useCallback } from "react";
import { MessageSquare, FolderOpen, FileText, Settings, Trash2, Edit2, Share2, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import DrivePanel from "./DrivePanel";
import LogPanel from "./LogPanel";
import ProjectChatPanel from "./project-chat/ProjectChatPanel";
import { useProjects } from "@/hooks/useProjects";
import { useSidebar } from "@/contexts/SidebarContext";
import toast from "react-hot-toast";

type MainTabType = "drive" | "log";

interface ProjectWorkspaceProps {
  projectId: string;
  projectName: string;
  isOwner?: boolean;
}

export default function ProjectWorkspace({ projectId, projectName, isOwner = true }: ProjectWorkspaceProps) {
  const [mainTab, setMainTab] = useState<MainTabType>("drive");
  const [isChatOpen, setIsChatOpen] = useState(false);
  const { isOpen: sidebarOpen, closeSidebar } = useSidebar();
  const [activeSpreadsheetId, setActiveSpreadsheetId] = useState<string | null>(null);
  const handleActiveSpreadsheetChange = useCallback((id: string | null) => {
    setActiveSpreadsheetId(id);
  }, []);

  const [showSettings, setShowSettings] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState(projectName);
  const [currentProjectName, setCurrentProjectName] = useState(projectName);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [shareLoading, setShareLoading] = useState(false);
  const { updateProject, deleteProject } = useProjects();
  const router = useRouter();
  const canManageProject = isOwner;

  const selectDriveTab = () => {
    setMainTab("drive");
    setIsChatOpen(false);
  };

  const selectChatTab = () => {
    setMainTab("drive");
    setIsChatOpen(true);
    closeSidebar();
  };

  const selectLogTab = () => {
    setMainTab("log");
    setIsChatOpen(false);
  };

  useEffect(() => {
    if (!isChatOpen) return;
    if (sidebarOpen) {
      setIsChatOpen(false);
    }
  }, [sidebarOpen, isChatOpen]);

  const handleRenameProject = async () => {
    if (!newProjectName.trim()) {
      toast.error("Project name cannot be empty");
      return;
    }

    try {
      await updateProject(projectId, newProjectName.trim());
      setCurrentProjectName(newProjectName.trim());
      toast.success("Project renamed successfully");
      setShowRenameModal(false);
      setShowSettings(false);
      window.dispatchEvent(new CustomEvent("projectUpdated", { detail: { projectId } }));
    } catch {
      toast.error("Failed to rename project");
    }
  };

  const handleDeleteProject = async () => {
    if (!confirm(`Are you sure you want to delete "${projectName}"?`)) return;

    try {
      await deleteProject(projectId);
      toast.success("Project deleted");
      router.push("/dashboard");
    } catch {
      toast.error("Failed to delete project");
    }
  };

  const handleShareProject = async () => {
    if (!canManageProject) return;

    setShareLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/share`, { method: "POST" });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error || "Unable to generate share link");
      }

      const data = await response.json();
      setShareUrl(data.shareUrl);
      setShareModalOpen(true);
      try {
        await navigator?.clipboard?.writeText(data.shareUrl);
        toast.success("Share link copied to clipboard");
      } catch {
        toast.success("Share link ready to copy");
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to generate share link";
      toast.error(message);
    } finally {
      setShareLoading(false);
      setShowSettings(false);
    }
  };

  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator?.clipboard?.writeText(shareUrl);
      toast.success("Share link copied to clipboard");
    } catch {
      toast.error("Unable to copy link");
    }
  };

  useEffect(() => {
    const handleNewSpreadsheetQuote = () => {
      selectDriveTab();
    };

    window.addEventListener(
      "newSpreadsheetQuoteStarted" as keyof WindowEventMap,
      handleNewSpreadsheetQuote,
    );
    return () => {
      window.removeEventListener(
        "newSpreadsheetQuoteStarted" as keyof WindowEventMap,
        handleNewSpreadsheetQuote,
      );
    };
  }, []);

  useEffect(() => {
    const handleEditSpreadsheetQuote = () => {
      selectDriveTab();
    };

    window.addEventListener(
      "editSpreadsheetQuoteStarted" as keyof WindowEventMap,
      handleEditSpreadsheetQuote,
    );
    return () => {
      window.removeEventListener(
        "editSpreadsheetQuoteStarted" as keyof WindowEventMap,
        handleEditSpreadsheetQuote,
      );
    };
  }, []);

  const driveTabActive = mainTab === "drive" && !isChatOpen;
  const chatTabActive = isChatOpen;
  const logTabActive = mainTab === "log";

  return (
    <div className="h-screen flex flex-col bg-white">
      <div className="border-b border-gray-200 bg-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>project</span>
          <span>/</span>
          <span className="text-gray-900 font-medium">{currentProjectName}</span>
        </div>
        {canManageProject && (
          <div className="relative">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Settings size={18} className="text-gray-600" />
            </button>

            {showSettings && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowSettings(false)} />
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                  <button
                    onClick={handleShareProject}
                    disabled={shareLoading}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 disabled:opacity-60"
                  >
                    <Share2 size={16} />
                    {shareLoading ? "Generating link..." : "Share Project"}
                  </button>
                  <button
                    onClick={() => {
                      setNewProjectName(projectName);
                      setShowRenameModal(true);
                      setShowSettings(false);
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <Edit2 size={16} />
                    Rename Project
                  </button>
                  <button
                    onClick={handleDeleteProject}
                    className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                  >
                    <Trash2 size={16} />
                    Delete Project
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex border-b border-gray-200 bg-white px-4">
        <button
          onClick={selectDriveTab}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            driveTabActive
              ? "border-gray-900 text-gray-900"
              : "border-transparent text-gray-600 hover:text-gray-900"
          }`}
        >
          <FolderOpen size={16} className="opacity-70" />
          Drive
        </button>
        <button
          onClick={selectChatTab}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            chatTabActive
              ? "border-gray-900 text-gray-900"
              : "border-transparent text-gray-600 hover:text-gray-900"
          }`}
        >
          <MessageSquare size={16} className="opacity-70" />
          Chat
        </button>
        <button
          onClick={selectLogTab}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            logTabActive
              ? "border-gray-900 text-gray-900"
              : "border-transparent text-gray-600 hover:text-gray-900"
          }`}
        >
          <FileText size={16} className="opacity-70" />
          Log
        </button>
      </div>

      <div className="flex-1 overflow-hidden relative min-h-0">
        <div className={mainTab === "drive" ? "flex h-full min-h-0" : "hidden"}>
          <div className="flex-1 min-w-0 h-full overflow-y-auto relative">
            <DrivePanel projectId={projectId} onActiveSpreadsheetChange={handleActiveSpreadsheetChange} />
          </div>
          {isChatOpen && (
            <ProjectChatPanel
              projectId={projectId}
              projectName={currentProjectName}
              activeSpreadsheetId={activeSpreadsheetId}
              className="w-[min(380px,38vw)] shrink-0"
            />
          )}
        </div>
        <div className={mainTab === "log" ? "h-full" : "hidden"}>
          <LogPanel projectId={projectId} />
        </div>
      </div>

      {showRenameModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4">Rename Project</h2>
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameProject();
                else if (e.key === "Escape") setShowRenameModal(false);
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent mb-4"
              placeholder="Enter new project name"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowRenameModal(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRenameProject}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {shareModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg">
            <h2 className="text-xl font-semibold mb-2">Share Project</h2>
            <p className="text-sm text-gray-600 mb-4">
              Send this link to anyone in your organization to open the project instantly.
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                value={shareUrl}
                readOnly
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <button
                onClick={copyShareUrl}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
              >
                <Copy size={16} />
                Copy
              </button>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShareModalOpen(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
