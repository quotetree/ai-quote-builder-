import { createClient } from "@/lib/supabase/client";

/**
 * Updates a project's updated_at timestamp to mark it as recently active.
 * This causes the project to appear at the top of the sidebar when sorted by updated_at DESC.
 * 
 * Call this function whenever a user performs any action within a project:
 * - Sends a chat message
 * - Creates/edits a quote
 * - Uploads/edits documents
 * - Makes any other project-related change
 * 
 * @param projectId - The ID of the project to update
 * @returns Promise that resolves when the timestamp is updated
 */
export async function updateProjectTimestamp(projectId: string): Promise<void> {
  try {
    const supabase = createClient();
    
    const { error } = await supabase
      .from("projects")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", projectId);
    
    if (error) {
      console.error("Failed to update project timestamp:", error);
      // Don't throw - this is a non-critical operation
    } else {
      console.log(`✅ Updated project timestamp for ${projectId}`);
    }
  } catch (err) {
    console.error("Error updating project timestamp:", err);
    // Don't throw - this is a non-critical operation
  }
}

/**
 * Server-side version for use in API routes
 */
export async function updateProjectTimestampServer(supabase: any, projectId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from("projects")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", projectId);
    
    if (error) {
      console.error("Failed to update project timestamp:", error);
    } else {
      console.log(`✅ Updated project timestamp for ${projectId}`);
    }
  } catch (err) {
    console.error("Error updating project timestamp:", err);
  }
}

