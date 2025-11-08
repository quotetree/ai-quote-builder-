/**
 * Helper to handle edit conflicts gracefully
 */

import { createClient } from "@/lib/supabase/client";

export async function checkForEditConflicts(quoteId: string, expectedVersion: number): Promise<{
  hasConflict: boolean;
  currentVersion: number;
  isBeingEdited: boolean;
  editSessionId: string | null;
}> {
  const supabase = createClient();
  
  try {
    const { data: quote } = await supabase
      .from("quotes")
      .select("version_number, is_editing, edit_session_id")
      .eq("id", quoteId)
      .single();
    
    if (!quote) {
      return {
        hasConflict: true,
        currentVersion: -1,
        isBeingEdited: false,
        editSessionId: null
      };
    }
    
    return {
      hasConflict: quote.version_number !== expectedVersion,
      currentVersion: quote.version_number,
      isBeingEdited: quote.is_editing || false,
      editSessionId: quote.edit_session_id
    };
  } catch (error) {
    console.error('Error checking for conflicts:', error);
    return {
      hasConflict: false,
      currentVersion: expectedVersion,
      isBeingEdited: false,
      editSessionId: null
    };
  }
}

export function getConflictMessage(conflict: {
  hasConflict: boolean;
  currentVersion: number;
  isBeingEdited: boolean;
}): string {
  if (conflict.isBeingEdited) {
    return `This quote is currently being edited by another user. The current version is v${conflict.currentVersion}. Please wait for them to finish or contact them to release the lock.`;
  }
  
  if (conflict.hasConflict) {
    return `Quote has been updated to v${conflict.currentVersion} by another user while you were editing. Your changes were not saved. Please refresh the page to see the latest version, then try editing again.`;
  }
  
  return "Unable to save changes. Please refresh and try again.";
}

