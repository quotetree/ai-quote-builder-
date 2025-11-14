-- Storage access policies for the private `project-files` bucket

-- Ensure the bucket exists (safe no-op if already created via dashboard)
insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', false)
on conflict (id) do update set public = excluded.public;

-- Clean up any previous policies so this migration is idempotent
drop policy if exists "Project files read access" on storage.objects;
drop policy if exists "Project files insert access" on storage.objects;
drop policy if exists "Project files update access" on storage.objects;
drop policy if exists "Project files delete access" on storage.objects;

-- Allow authenticated users to read only the objects they own in the bucket
create policy "Project files read access"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'project-files'
  and owner = auth.uid()
);

-- Allow authenticated users to upload files into the bucket
create policy "Project files insert access"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'project-files'
  and (
    owner = auth.uid()
    or owner is null
  )
);

-- Allow authenticated users to update their own objects
create policy "Project files update access"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'project-files'
  and owner = auth.uid()
);

-- Allow authenticated users to delete their own objects
create policy "Project files delete access"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'project-files'
  and owner = auth.uid()
);

