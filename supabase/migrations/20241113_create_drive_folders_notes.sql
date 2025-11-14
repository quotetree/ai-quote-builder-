-- Drive folders and notes support

-- Folders table
create table if not exists project_folders (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  parent_folder_id uuid references project_folders(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_folders_project_idx on project_folders(project_id);
create index if not exists project_folders_parent_idx on project_folders(parent_folder_id);

alter table project_folders enable row level security;

create policy if not exists "Users can view own folders" on project_folders
for select using (auth.uid() = (select user_id from projects where projects.id = project_folders.project_id));

create policy if not exists "Users can insert own folders" on project_folders
for insert with check (auth.uid() = (select user_id from projects where projects.id = project_folders.project_id));

create policy if not exists "Users can update own folders" on project_folders
for update using (auth.uid() = (select user_id from projects where projects.id = project_folders.project_id));

create policy if not exists "Users can delete own folders" on project_folders
for delete using (auth.uid() = (select user_id from projects where projects.id = project_folders.project_id));

-- Allow documents to reference folders
alter table project_documents
  add column if not exists folder_id uuid references project_folders(id) on delete set null;

create index if not exists project_documents_folder_idx on project_documents(folder_id);

-- Notes table
create table if not exists project_notes (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  folder_id uuid references project_folders(id) on delete set null,
  title text not null,
  content jsonb not null default '{}'::jsonb,
  plain_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_notes_project_idx on project_notes(project_id);
create index if not exists project_notes_folder_idx on project_notes(folder_id);

alter table project_notes enable row level security;

create policy if not exists "Users can view own notes" on project_notes
for select using (auth.uid() = (select user_id from projects where projects.id = project_notes.project_id));

create policy if not exists "Users can insert own notes" on project_notes
for insert with check (auth.uid() = (select user_id from projects where projects.id = project_notes.project_id));

create policy if not exists "Users can update own notes" on project_notes
for update using (auth.uid() = (select user_id from projects where projects.id = project_notes.project_id));

create policy if not exists "Users can delete own notes" on project_notes
for delete using (auth.uid() = (select user_id from projects where projects.id = project_notes.project_id));

-- Reuse existing timestamp trigger for folders/notes
create trigger if not exists update_project_folders_updated_at
  before update on project_folders
  for each row execute function update_updated_at_column();

create trigger if not exists update_project_notes_updated_at
  before update on project_notes
  for each row execute function update_updated_at_column();

