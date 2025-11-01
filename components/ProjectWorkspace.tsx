"use client";

import { useState } from "react";
import { MessageSquare, FolderOpen, FileText, Settings, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import ChatPanel from "./ChatPanel";
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
  const { deleteProject } = useProjects();
  const router = useRouter();

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
          <span className="text-gray-900 font-medium">{projectName}</span>
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
          <ChatPanel projectId={projectId} projectName={projectName} />
        </div>
        <div className={activeTab === "drive" ? "h-full" : "hidden"}>
          <DrivePanel projectId={projectId} />
        </div>
        <div className={activeTab === "log" ? "h-full" : "hidden"}>
          <LogPanel projectId={projectId} />
        </div>
      </div>
    </div>
  );
}

