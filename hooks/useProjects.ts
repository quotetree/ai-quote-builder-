import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Project } from "@/types/database";

type FetchProjectsOptions = {
  silent?: boolean;
};

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    fetchProjects();
  }, []);

  async function fetchProjects(options?: FetchProjectsOptions) {
    const shouldShowLoading = !options?.silent;

    try {
      if (shouldShowLoading) {
        setLoading(true);
      }

      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(50); // Limit to 50 most recent projects for better performance

      if (error) throw error;
      setProjects(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      if (shouldShowLoading) {
        setLoading(false);
      }
    }
  }

  async function createProject(name: string, families: string[]) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Get user's organization_id from their membership
      const { data: membership, error: membershipError } = await supabase
        .from("organization_memberships")
        .select("organization_id")
        .eq("user_id", user.id)
        .single();

      if (membershipError || !membership) {
        throw new Error("Organization membership not found. Please refresh and try again.");
      }

      const { data, error } = await supabase
        .from("projects")
        .insert({
          user_id: user.id,
          organization_id: membership.organization_id,
          project_name: name,
          product_families: families,
        })
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setProjects([data, ...projects]);
      }
      return data;
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  async function updateProject(id: string, name: string) {
    try {
      const { data, error } = await supabase
        .from("projects")
        .update({ project_name: name })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setProjects(projects.map((p) => (p.id === id ? data : p)));
      }
      return data;
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  async function deleteProject(id: string) {
    try {
      const { error } = await supabase
        .from("projects")
        .update({ status: "deleted" })
        .eq("id", id);

      if (error) throw error;
      setProjects(projects.filter((p) => p.id !== id));
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  return {
    projects,
    loading,
    error,
    fetchProjects,
    createProject,
    updateProject,
    deleteProject,
  };
}

