-- Allow authenticated users to rename/update their project documents

create policy "Users can update docs in own projects"
on project_documents
for update
to authenticated
using (
  exists (
    select 1
    from projects
    where projects.id = project_documents.project_id
      and projects.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from projects
    where projects.id = project_documents.project_id
      and projects.user_id = auth.uid()
  )
);

