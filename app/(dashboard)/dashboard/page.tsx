"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { trackProjectCreated } from "@/lib/analytics";
import toast from "react-hot-toast";

export default function DashboardPage() {
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [projectInputFocused, setProjectInputFocused] = useState(false);
  const { createProject } = useProjects();
  const router = useRouter();

  const handleCreateProject = async () => {
    if (!projectName.trim()) {
      toast.error("Please enter a project name");
      return;
    }

    setCreating(true);
    try {
      const project = await createProject(projectName.trim(), []);
      if (project) {
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
            <div className="absolute left-4 top-1/2 transform -translate-y-1/2">
              <Plus size={20} className="text-gray-400" />
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
              className="w-full pl-12 pr-4 py-4 bg-gray-100 rounded-xl text-lg placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300 transition-all disabled:opacity-50"
            />
          </div>
        </div>

        {/* Create Button */}
        <button
          onClick={handleCreateProject}
          disabled={!projectName.trim() || creating}
          className="w-full py-4 bg-gray-800 hover:bg-gray-900 text-white rounded-xl font-medium text-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-800"
        >
          {creating ? "Creating..." : "Create project"}
        </button>
      </div>
    </div>
  );
}

