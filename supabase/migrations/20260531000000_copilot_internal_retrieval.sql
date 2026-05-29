-- Copilot internal retrieval: memories, project/quote similarity profiles, pgvector RPCs

-- ---------------------------------------------------------------------------
-- Copilot memories (user / organization / project scope)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS copilot_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('user', 'organization', 'project')),
  title TEXT,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  embedding vector(1536),
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT copilot_memories_scope_fk CHECK (
    (scope = 'user' AND user_id IS NOT NULL)
    OR (scope = 'organization' AND user_id IS NULL AND project_id IS NULL)
    OR (scope = 'project' AND project_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS copilot_memories_org_idx ON copilot_memories(organization_id);
CREATE INDEX IF NOT EXISTS copilot_memories_project_idx ON copilot_memories(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS copilot_memories_user_idx ON copilot_memories(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS copilot_memories_enabled_idx ON copilot_memories(organization_id, is_enabled);

CREATE INDEX IF NOT EXISTS copilot_memories_embedding_hnsw_idx
  ON copilot_memories
  USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL AND is_enabled = true;

-- ---------------------------------------------------------------------------
-- Project retrieval profiles (prior quotes / similar projects)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_retrieval_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_name TEXT NOT NULL,
  profile_text TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  embedding vector(1536),
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id)
);

CREATE INDEX IF NOT EXISTS project_retrieval_profiles_org_idx
  ON project_retrieval_profiles(organization_id);

CREATE INDEX IF NOT EXISTS project_retrieval_profiles_embedding_hnsw_idx
  ON project_retrieval_profiles
  USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- Product embeddings index (column exists in base schema)
CREATE INDEX IF NOT EXISTS products_embedding_hnsw_idx
  ON products
  USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- Optional: cached embedding source text for backfill idempotency
ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding_text TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding_indexed_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE copilot_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_retrieval_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view copilot memories"
  ON copilot_memories FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_memberships om
      WHERE om.organization_id = copilot_memories.organization_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can manage own user memories"
  ON copilot_memories FOR INSERT
  WITH CHECK (
    scope = 'user'
    AND user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM organization_memberships om
      WHERE om.organization_id = copilot_memories.organization_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage org and project memories"
  ON copilot_memories FOR INSERT
  WITH CHECK (
    (scope IN ('organization', 'project'))
    AND EXISTS (
      SELECT 1 FROM organization_memberships om
      WHERE om.organization_id = copilot_memories.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'super_admin', 'admin')
    )
  );

CREATE POLICY "Users can update own user memories"
  ON copilot_memories FOR UPDATE
  USING (scope = 'user' AND user_id = auth.uid());

CREATE POLICY "Admins can update org and project memories"
  ON copilot_memories FOR UPDATE
  USING (
    scope IN ('organization', 'project')
    AND EXISTS (
      SELECT 1 FROM organization_memberships om
      WHERE om.organization_id = copilot_memories.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'super_admin', 'admin')
    )
  );

CREATE POLICY "Users can delete own user memories"
  ON copilot_memories FOR DELETE
  USING (scope = 'user' AND user_id = auth.uid());

CREATE POLICY "Admins can delete org and project memories"
  ON copilot_memories FOR DELETE
  USING (
    scope IN ('organization', 'project')
    AND EXISTS (
      SELECT 1 FROM organization_memberships om
      WHERE om.organization_id = copilot_memories.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'super_admin', 'admin')
    )
  );

CREATE POLICY "Org members can view project retrieval profiles"
  ON project_retrieval_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_memberships om
      WHERE om.organization_id = project_retrieval_profiles.organization_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can upsert project retrieval profiles"
  ON project_retrieval_profiles FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM organization_memberships om
      WHERE om.organization_id = project_retrieval_profiles.organization_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can update project retrieval profiles"
  ON project_retrieval_profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM organization_memberships om
      WHERE om.organization_id = project_retrieval_profiles.organization_id
        AND om.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- pgvector match functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_products(
  query_embedding vector(1536),
  match_organization_id UUID,
  match_count INT DEFAULT 30,
  match_threshold FLOAT DEFAULT 0.25
)
RETURNS TABLE (
  id UUID,
  product_name TEXT,
  product_number TEXT,
  product_brand TEXT,
  product_type TEXT,
  product_tags TEXT[],
  description TEXT,
  list_price DECIMAL,
  sales_price DECIMAL,
  cost_price DECIMAL,
  unit TEXT,
  similarity FLOAT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p.id,
    p.product_name,
    p.product_number,
    p.product_brand,
    p.product_type,
    p.product_tags,
    p.description,
    p.list_price,
    p.sales_price,
    p.cost_price,
    p.unit,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM products p
  WHERE p.organization_id = match_organization_id
    AND p.embedding IS NOT NULL
    AND 1 - (p.embedding <=> query_embedding) >= match_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION match_copilot_memories(
  query_embedding vector(1536),
  match_organization_id UUID,
  match_user_id UUID,
  match_project_id UUID,
  match_count INT DEFAULT 15,
  match_threshold FLOAT DEFAULT 0.25
)
RETURNS TABLE (
  id UUID,
  scope TEXT,
  title TEXT,
  content TEXT,
  tags TEXT[],
  project_id UUID,
  similarity FLOAT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    m.id,
    m.scope,
    m.title,
    m.content,
    m.tags,
    m.project_id,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM copilot_memories m
  WHERE m.organization_id = match_organization_id
    AND m.is_enabled = true
    AND m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> query_embedding) >= match_threshold
    AND (
      m.scope = 'organization'
      OR (m.scope = 'user' AND m.user_id = match_user_id)
      OR (m.scope = 'project' AND m.project_id = match_project_id)
    )
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION match_project_retrieval_profiles(
  query_embedding vector(1536),
  match_organization_id UUID,
  exclude_project_id UUID,
  match_count INT DEFAULT 8,
  match_threshold FLOAT DEFAULT 0.22
)
RETURNS TABLE (
  id UUID,
  project_id UUID,
  project_name TEXT,
  profile_text TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    pr.id,
    pr.project_id,
    pr.project_name,
    pr.profile_text,
    pr.metadata,
    1 - (pr.embedding <=> query_embedding) AS similarity
  FROM project_retrieval_profiles pr
  WHERE pr.organization_id = match_organization_id
    AND pr.project_id IS DISTINCT FROM exclude_project_id
    AND pr.embedding IS NOT NULL
    AND 1 - (pr.embedding <=> query_embedding) >= match_threshold
  ORDER BY pr.embedding <=> query_embedding
  LIMIT match_count;
$$;
