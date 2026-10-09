-- Kuppi: peer-tutoring sessions held on Zoom, Meet or Teams (or in person), with RSVPs.

create table kuppi.sessions (
  id uuid primary key default ops.uuid_v7(),
  host_id uuid not null references identity.profiles (user_id) on delete cascade,
  module_id bigint not null references academics.modules (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  description text check (char_length(description) <= 1000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  mode text not null check (mode in ('online', 'in_person')),
  venue text check (char_length(venue) <= 160),
  capacity integer not null check (capacity between 2 and 1000),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint sessions_time_order check (ends_at > starts_at),
  constraint sessions_venue_for_in_person check (mode = 'online' or venue is not null)
);
-- Upcoming kuppi for a module (the browse screen).
create index sessions_module_upcoming_idx on kuppi.sessions (module_id, starts_at)
  where cancelled_at is null;
create index sessions_host_idx on kuppi.sessions (host_id);

-- Kept apart from sessions so it can never be read directly. api.reveal_link (task F1) returns
-- it only to students who RSVP'd, from 15 minutes before the start.
create table kuppi.session_links (
  session_id uuid primary key references kuppi.sessions (id) on delete cascade,
  meeting_url text not null check (meeting_url ~ '^https://' and char_length(meeting_url) <= 500)
);

create table kuppi.rsvps (
  session_id uuid not null references kuppi.sessions (id) on delete cascade,
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
create index rsvps_user_idx on kuppi.rsvps (user_id);

alter table kuppi.sessions enable row level security;
alter table kuppi.session_links enable row level security;
alter table kuppi.rsvps enable row level security;

grant select on kuppi.sessions to authenticated;
create policy "sessions at my institution" on kuppi.sessions
  for select to authenticated
  using (
    exists (
      select 1 from academics.modules m
      where m.id = module_id and m.institution_id = (select identity.current_institution_id())
    )
  );

grant select on kuppi.rsvps to authenticated;
create policy "own rsvps, or rsvps to my sessions" on kuppi.rsvps
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from kuppi.sessions s where s.id = session_id and s.host_id = (select auth.uid()))
  );
-- kuppi.session_links: no grants and no policies. Reachable only through api functions.
