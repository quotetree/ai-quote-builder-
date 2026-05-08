-- Migration: Create proposal-assets storage bucket for uploaded PDF/image pages

-- Create the bucket (public so URLs can be embedded in proposals)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'proposal-assets',
  'proposal-assets',
  true,
  52428800, -- 50 MB per file
  ARRAY['image/png','image/jpeg','image/jpg','image/gif','image/webp','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Org members can upload files
CREATE POLICY "proposal_assets_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'proposal-assets' AND
    auth.uid() IS NOT NULL
  );

-- Public read (pages are embedded as img src in proposals)
CREATE POLICY "proposal_assets_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'proposal-assets');

-- Uploaders can delete their own files
CREATE POLICY "proposal_assets_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'proposal-assets' AND auth.uid() = owner);
