-- Content: shared study resources (notes, past papers, slides). Files live in object storage;
-- rows hold the metadata. Rows are written only by api functions (upload flow, task E2).

create table content.resources (
  id uuid primary key default ops.uuid_v7(),
  module_id bigint not null references academics.modules (id) on delete cascade,
  uploader_id uuid references identity.profiles (user_id) on delete set null,
  title text not null check (char_length(btrim(title)) between 3 and 160),
  kind text not null check (kind in ('notes', 'past_paper', 'slides', 'other')),
  storage_key text not null unique check (char_length(storage_key) <= 300),
  mime_type text not null check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg', 'image/png', 'image/webp'
  )),
  size_bytes integer not null check (size_bytes between 1 and 26214400),
  -- pending until scanned; quarantined holds it for a moderator.
  status text not null default 'pending' check (status in ('pending', 'live', 'quarantined', 'removed')),
  search tsvector generated always as (to_tsvector('simple', title)) stored,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
-- Browse a module's live resources, newest first (the hot path).
create index resources_module_live_idx on content.resources (module_id, created_at desc)
  where status = 'live' and deleted_at is null;
create index resources_uploader_idx on content.resources (uploader_id);
create index resources_search_idx on content.resources using gin (search);
create index resources_title_trgm_idx on content.resources using gin (title extensions.gin_trgm_ops);

alter table content.resources enable row level security;

grant select on content.resources to authenticated;
create policy "live resources at my institution" on content.resources
  for select to authenticated
  using (
    status = 'live'
    and deleted_at is null
    and exists (
      select 1 from academics.modules m
      where m.id = module_id and m.institution_id = (select identity.current_institution_id())
    )
  );
