-- Migration: Auto-update project.updated_at when activity occurs
-- This ensures projects are properly sorted by most recent activity in the sidebar

-- Function to update parent project's updated_at timestamp
CREATE OR REPLACE FUNCTION update_parent_project_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the project's updated_at to NOW whenever a related record changes
  UPDATE projects 
  SET updated_at = NOW() 
  WHERE id = COALESCE(NEW.project_id, OLD.project_id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Update project timestamp when quotes are created or updated
DROP TRIGGER IF EXISTS trigger_update_project_on_quote ON quotes;
CREATE TRIGGER trigger_update_project_on_quote
  AFTER INSERT OR UPDATE ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION update_parent_project_timestamp();

-- Trigger: Update project timestamp when chat messages are added
DROP TRIGGER IF EXISTS trigger_update_project_on_chat ON chat_messages;
CREATE TRIGGER trigger_update_project_on_chat
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_parent_project_timestamp();

-- Trigger: Update project timestamp when documents are uploaded
DROP TRIGGER IF EXISTS trigger_update_project_on_document ON project_documents;
CREATE TRIGGER trigger_update_project_on_document
  AFTER INSERT ON project_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_parent_project_timestamp();

-- Trigger: Update project timestamp when notes are created or updated
DROP TRIGGER IF EXISTS trigger_update_project_on_note ON project_notes;
CREATE TRIGGER trigger_update_project_on_note
  AFTER INSERT OR UPDATE ON project_notes
  FOR EACH ROW
  EXECUTE FUNCTION update_parent_project_timestamp();

-- Trigger: Update project timestamp when folders are created or updated
DROP TRIGGER IF EXISTS trigger_update_project_on_folder ON project_folders;
CREATE TRIGGER trigger_update_project_on_folder
  AFTER INSERT OR UPDATE ON project_folders
  FOR EACH ROW
  EXECUTE FUNCTION update_parent_project_timestamp();

-- Note: We don't need to update on DELETE operations since deleting content
-- shouldn't bump the project to the top of the list

