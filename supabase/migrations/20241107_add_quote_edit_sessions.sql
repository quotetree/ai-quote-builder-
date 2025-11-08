-- Migration to add Edit Quote workflow with versioning and session management

-- Add new columns to quotes table for versioning and editing
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS parent_quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edit_session_id TEXT,
  ADD COLUMN IF NOT EXISTS change_notes TEXT,
  ADD COLUMN IF NOT EXISTS diff_summary JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS author_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_editing BOOLEAN DEFAULT false;

-- Index for versioning queries
CREATE INDEX IF NOT EXISTS idx_quotes_parent_quote_id ON quotes(parent_quote_id);
CREATE INDEX IF NOT EXISTS idx_quotes_edit_session_id ON quotes(edit_session_id);
CREATE INDEX IF NOT EXISTS idx_quotes_version ON quotes(quote_number, version_number);

-- Add edit session tracking to project_working_state
ALTER TABLE project_working_state
  ADD COLUMN IF NOT EXISTS current_edit_session_id TEXT,
  ADD COLUMN IF NOT EXISTS current_quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edit_mode BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS current_pool_id TEXT,
  ADD COLUMN IF NOT EXISTS edit_started_at TIMESTAMPTZ;

-- Create quote_edit_sessions table for tracking active edit sessions
CREATE TABLE IF NOT EXISTS quote_edit_sessions (
  id TEXT PRIMARY KEY,
  quote_id UUID REFERENCES quotes(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  version_being_edited INTEGER NOT NULL,
  snapshot JSONB NOT NULL, -- The approved version snapshot
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for edit sessions
CREATE INDEX IF NOT EXISTS idx_edit_sessions_quote_id ON quote_edit_sessions(quote_id);
CREATE INDEX IF NOT EXISTS idx_edit_sessions_project_id ON quote_edit_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_edit_sessions_user_id ON quote_edit_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_edit_sessions_status ON quote_edit_sessions(status);

-- Enable RLS on edit sessions
ALTER TABLE quote_edit_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own edit sessions
CREATE POLICY "Users can manage their own edit sessions"
  ON quote_edit_sessions
  FOR ALL
  USING (user_id = auth.uid());

-- Create quote_version_history table for audit trail
CREATE TABLE IF NOT EXISTS quote_version_history (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  quote_id UUID REFERENCES quotes(id) ON DELETE CASCADE NOT NULL,
  version_number INTEGER NOT NULL,
  changed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  change_type TEXT CHECK (change_type IN ('created', 'edited', 'approved', 'declined', 'status_changed')),
  change_notes TEXT,
  diff_summary JSONB DEFAULT '{}',
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for version history
CREATE INDEX IF NOT EXISTS idx_version_history_quote_id ON quote_version_history(quote_id);
CREATE INDEX IF NOT EXISTS idx_version_history_version ON quote_version_history(quote_id, version_number);
CREATE INDEX IF NOT EXISTS idx_version_history_created_at ON quote_version_history(created_at DESC);

-- Enable RLS on version history
ALTER TABLE quote_version_history ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view version history for their own quotes
CREATE POLICY "Users can view their own quote version history"
  ON quote_version_history
  FOR SELECT
  USING (
    quote_id IN (
      SELECT id FROM quotes WHERE user_id = auth.uid()
    )
  );

-- Policy: System can insert version history
CREATE POLICY "System can insert version history"
  ON quote_version_history
  FOR INSERT
  WITH CHECK (
    quote_id IN (
      SELECT id FROM quotes WHERE user_id = auth.uid()
    )
  );

-- Function to create version snapshot when quote is created/updated
CREATE OR REPLACE FUNCTION create_quote_version_snapshot()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create snapshot for new versions or significant changes
  IF (TG_OP = 'INSERT') OR (OLD.version_number != NEW.version_number) THEN
    INSERT INTO quote_version_history (
      quote_id,
      version_number,
      changed_by,
      change_type,
      change_notes,
      diff_summary,
      snapshot
    ) VALUES (
      NEW.id,
      NEW.version_number,
      NEW.author_id,
      CASE
        WHEN TG_OP = 'INSERT' THEN 'created'
        ELSE 'edited'
      END,
      NEW.change_notes,
      NEW.diff_summary,
      jsonb_build_object(
        'quote_number', NEW.quote_number,
        'quote_name', NEW.quote_name,
        'version_number', NEW.version_number,
        'status', NEW.status,
        'scope_of_work', NEW.scope_of_work,
        'subtotal', NEW.subtotal,
        'tax_rate', NEW.tax_rate,
        'tax_amount', NEW.tax_amount,
        'discount_rate', NEW.discount_rate,
        'discount_amount', NEW.discount_amount,
        'total_price', NEW.total_price,
        'profit_margin', NEW.profit_margin,
        'created_at', NEW.created_at,
        'updated_at', NEW.updated_at
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-create version snapshots
DROP TRIGGER IF EXISTS trigger_create_quote_version_snapshot ON quotes;
CREATE TRIGGER trigger_create_quote_version_snapshot
  AFTER INSERT OR UPDATE ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION create_quote_version_snapshot();

-- Function to clean up stale edit sessions (inactive for > 24 hours)
CREATE OR REPLACE FUNCTION cleanup_stale_edit_sessions()
RETURNS INTEGER AS $$
DECLARE
  stale_count INTEGER;
BEGIN
  WITH stale_sessions AS (
    UPDATE quote_edit_sessions
    SET status = 'cancelled'
    WHERE status = 'active'
      AND last_activity_at < NOW() - INTERVAL '24 hours'
    RETURNING id
  )
  SELECT COUNT(*) INTO stale_count FROM stale_sessions;
  
  RETURN stale_count;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE quote_edit_sessions IS 'Tracks active quote edit sessions for isolation and concurrency control';
COMMENT ON TABLE quote_version_history IS 'Immutable audit log of all quote versions and changes';
COMMENT ON COLUMN quotes.parent_quote_id IS 'References the previous version of this quote (for versioning)';
COMMENT ON COLUMN quotes.edit_session_id IS 'Active edit session ID if quote is being edited';
COMMENT ON COLUMN quotes.diff_summary IS 'JSON summary of changes from previous version';
COMMENT ON COLUMN project_working_state.current_edit_session_id IS 'Active edit session for this project';
COMMENT ON COLUMN project_working_state.edit_mode IS 'Whether project is currently in edit mode';

