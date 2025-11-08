/**
 * Verify Edit Quote Database Schema
 * 
 * Run this to check if the edit quote migration has been applied
 */

import { createClient } from "@/lib/supabase/client";

export async function verifyEditQuoteSchema(): Promise<{
  isValid: boolean;
  missingTables: string[];
  missingColumns: string[];
  errors: string[];
}> {
  const supabase = createClient();
  const missingTables: string[] = [];
  const missingColumns: string[] = [];
  const errors: string[] = [];

  try {
    // Check if quote_edit_sessions table exists
    const { error: sessionsError } = await supabase
      .from("quote_edit_sessions")
      .select("id")
      .limit(1);

    if (sessionsError) {
      if (sessionsError.code === '42P01') {
        missingTables.push('quote_edit_sessions');
      } else {
        errors.push(`quote_edit_sessions: ${sessionsError.message}`);
      }
    }

    // Check if quote_version_history table exists
    const { error: historyError } = await supabase
      .from("quote_version_history")
      .select("id")
      .limit(1);

    if (historyError) {
      if (historyError.code === '42P01') {
        missingTables.push('quote_version_history');
      } else {
        errors.push(`quote_version_history: ${historyError.message}`);
      }
    }

    // Check if new columns exist on quotes table
    const { data: quoteTest, error: quoteError } = await supabase
      .from("quotes")
      .select("id, is_editing, edit_session_id, parent_quote_id, change_notes, diff_summary, author_id")
      .limit(1)
      .maybeSingle();

    if (quoteError) {
      if (quoteError.code === '42703') {
        // Column doesn't exist
        missingColumns.push('quotes table columns (is_editing, edit_session_id, etc.)');
      } else {
        errors.push(`quotes columns: ${quoteError.message}`);
      }
    }

    // Check if new columns exist on project_working_state table
    const { data: stateTest, error: stateError } = await supabase
      .from("project_working_state")
      .select("id, current_edit_session_id, current_quote_id, edit_mode, edit_started_at")
      .limit(1)
      .maybeSingle();

    if (stateError) {
      if (stateError.code === '42703') {
        missingColumns.push('project_working_state columns (current_edit_session_id, edit_mode, etc.)');
      } else {
        errors.push(`project_working_state columns: ${stateError.message}`);
      }
    }

    const isValid = missingTables.length === 0 && missingColumns.length === 0 && errors.length === 0;

    return {
      isValid,
      missingTables,
      missingColumns,
      errors
    };

  } catch (error: any) {
    return {
      isValid: false,
      missingTables,
      missingColumns,
      errors: [error.message || 'Unknown error during schema verification']
    };
  }
}

export async function logSchemaStatus() {
  console.log('🔍 Verifying Edit Quote database schema...');
  
  const result = await verifyEditQuoteSchema();
  
  if (result.isValid) {
    console.log('✅ Edit Quote schema is valid - all tables and columns exist');
    return true;
  } else {
    console.error('❌ Edit Quote schema validation failed:');
    
    if (result.missingTables.length > 0) {
      console.error('  Missing tables:', result.missingTables.join(', '));
    }
    
    if (result.missingColumns.length > 0) {
      console.error('  Missing columns:', result.missingColumns.join(', '));
    }
    
    if (result.errors.length > 0) {
      console.error('  Errors:', result.errors.join('; '));
    }
    
    console.error('\n📚 To fix this, apply the migration:');
    console.error('   1. Open Supabase Dashboard SQL Editor');
    console.error('   2. Copy/paste: supabase/migrations/20241107_add_quote_edit_sessions.sql');
    console.error('   3. Run the query');
    console.error('\n   See EDIT_QUOTE_QUICK_START.md for detailed instructions.');
    
    return false;
  }
}

