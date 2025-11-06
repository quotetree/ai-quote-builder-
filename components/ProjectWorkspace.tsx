"use client";

import { useState } from "react";
import { MessageSquare, FolderOpen, FileText, Settings, Trash2, Edit2 } from "lucide-react";
import { useRouter } from "next/navigation";
import SplitChatPanel from "./SplitChatPanel";
import DrivePanel from "./DrivePanel";
import LogPanel from "./LogPanel";
import { useProjects } from "@/hooks/useProjects";
import toast from "react-hot-toast";

type TabType = "chat" | "drive" | "log";

interface ProjectWorkspaceProps {
  projectId: string;
  projectName: string;
}

export default function ProjectWorkspace({ projectId, projectName }: ProjectWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<TabType>("chat");
  const [showSettings, setShowSettings] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState(projectName);
  const [currentProjectName, setCurrentProjectName] = useState(projectName);
  const { updateProject, deleteProject } = useProjects();
  const router = useRouter();

  const handleRenameProject = async () => {
    if (!newProjectName.trim()) {
      toast.error("Project name cannot be empty");
      return;
    }

    try {
      await updateProject(projectId, newProjectName.trim());
      // Update local state to reflect the new name in breadcrumb
      setCurrentProjectName(newProjectName.trim());
      toast.success("Project renamed successfully");
      setShowRenameModal(false);
      setShowSettings(false);
      // Dispatch custom event to notify sidebar to refresh
      window.dispatchEvent(new CustomEvent('projectUpdated', { detail: { projectId } }));
    } catch (error) {
      toast.error("Failed to rename project");
    }
  };

  const handleDeleteProject = async () => {
    if (!confirm(`Are you sure you want to delete "${projectName}"?`)) return;

    try {
      await deleteProject(projectId);
      toast.success("Project deleted");
      router.push("/dashboard");
    } catch (error) {
      toast.error("Failed to delete project");
    }
  };

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Breadcrumb Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>project</span>
          <span>/</span>
          <span className="text-gray-900 font-medium">{currentProjectName}</span>
        </div>
        <div className="relative">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <Settings size={18} className="text-gray-600" />
          </button>
          
          {/* Settings Dropdown */}
          {showSettings && (
            <>
              <div 
                className="fixed inset-0 z-10" 
                onClick={() => setShowSettings(false)}
              />
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
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
      </div>

      {/* Tab Navigation - Horizontal Tabs */}
      <div className="flex border-b border-gray-200 bg-white px-4">
        <button
          onClick={() => setActiveTab("chat")}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "chat"
              ? "border-gray-900 text-gray-900"
              : "border-transparent text-gray-600 hover:text-gray-900"
          }`}
        >
          Chat
        </button>
        <button
          onClick={() => setActiveTab("drive")}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "drive"
              ? "border-gray-900 text-gray-900"
              : "border-transparent text-gray-600 hover:text-gray-900"
          }`}
        >
          Drive
        </button>
        <button
          onClick={() => setActiveTab("log")}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "log"
              ? "border-gray-900 text-gray-900"
              : "border-transparent text-gray-600 hover:text-gray-900"
          }`}
        >
          Log
        </button>
      </div>

      {/* Panel Content - Keep all mounted to prevent re-initialization */}
      <div className="flex-1 overflow-hidden relative">
        <div className={activeTab === "chat" ? "h-full" : "hidden"}>
          <SplitChatPanel projectId={projectId} projectName={projectName} />
        </div>
        <div className={activeTab === "drive" ? "h-full" : "hidden"}>
          <DrivePanel projectId={projectId} />
        </div>
        <div className={activeTab === "log" ? "h-full" : "hidden"}>
          <LogPanel projectId={projectId} />
        </div>
      </div>

      {/* Rename Project Modal */}
      {showRenameModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4">Rename Project</h2>
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleRenameProject();
                } else if (e.key === "Escape") {
                  setShowRenameModal(false);
                }
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
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
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

