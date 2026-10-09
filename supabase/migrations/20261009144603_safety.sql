-- Safety: blocks, reports, moderation actions and appeals.

create table safety.blocks (
  blocker_id uuid not null references identity.profiles (user_id) on delete cascade,
  blocked_id uuid not null references identity.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);
-- "Has this person blocked me?" checks in both directions.
create index blocks_blocked_idx on safety.blocks (blocked_id, blocker_id);

create table safety.report_categories (
  code text primary key check (code ~ '^[a-z_]+$'),
  label text not null,
  -- 1 = handle first (ragging, threats, self-harm: 2-hour target).
  priority smallint not null check (priority between 1 and 3)
);
insert into safety.report_categories (code, label, priority) values
  ('ragging_or_threats', 'Ragging or threats', 1),
  ('self_harm', 'Self-harm or suicide', 1),
  ('harassment', 'Harassment or bullying', 2),
  ('hate', 'Hate based on identity', 2),
  ('sexual_content', 'Sexual content', 2),
  ('scam', 'Scam or fraud', 2),
  ('impersonation', 'Pretending to be someone else', 2),
  ('copyright', 'Copyright', 3),
  ('leaked_exam', 'Leaked exam paper', 1),
  ('spam', 'Spam', 3),
  ('other', 'Something else', 3);

create table safety.reports (
  id uuid primary key default ops.uuid_v7(),
  reporter_id uuid references identity.profiles (user_id) on delete set null,
  -- The institution whose moderators handle it (the reported user's or content's).
  institution_id bigint not null references identity.institutions (id) on delete cascade,
  target_kind text not null check (target_kind in ('profile', 'message', 'resource', 'kuppi', 'conversation')),
  target_id text not null,
  category_code text not null references safety.report_categories (code),
  details text check (char_length(details) <= 1000),
  -- Copy of the reported content (plus surrounding messages) taken at report time, so the
  -- evidence survives deletion by the author.
  snapshot jsonb not null,
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
-- Moderator queue: open reports for an institution, oldest first.
create index reports_open_queue_idx on safety.reports (institution_id, created_at) where status = 'open';
create index reports_reporter_idx on safety.reports (reporter_id);
create index reports_category_idx on safety.reports (category_code);
create index reports_target_idx on safety.reports (target_kind, target_id);

create table safety.moderation_actions (
  id uuid primary key default ops.uuid_v7(),
  report_id uuid references safety.reports (id) on delete set null,
  moderator_id uuid references identity.profiles (user_id) on delete set null,
  subject_user_id uuid references identity.profiles (user_id) on delete cascade,
  action text not null check (action in ('dismiss', 'remove_content', 'warn', 'mute', 'suspend', 'ban')),
  reason text not null check (char_length(reason) between 3 and 1000),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index moderation_actions_report_idx on safety.moderation_actions (report_id);
create index moderation_actions_moderator_idx on safety.moderation_actions (moderator_id);
create index moderation_actions_subject_idx on safety.moderation_actions (subject_user_id, created_at desc);

create table safety.appeals (
  id uuid primary key default ops.uuid_v7(),
  action_id uuid not null unique references safety.moderation_actions (id) on delete cascade,
  statement text not null check (char_length(statement) between 10 and 2000),
  status text not null default 'open' check (status in ('open', 'upheld', 'overturned')),
  -- Must differ from the moderator who took the action; enforced in the api function.
  reviewed_by uuid references identity.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index appeals_reviewed_by_idx on safety.appeals (reviewed_by);

alter table safety.blocks enable row level security;
alter table safety.report_categories enable row level security;
alter table safety.reports enable row level security;
alter table safety.moderation_actions enable row level security;
alter table safety.appeals enable row level security;

grant select on safety.report_categories to authenticated;
create policy "read categories" on safety.report_categories for select to authenticated using (true);

grant select on safety.blocks to authenticated;
create policy "own blocks" on safety.blocks
  for select to authenticated using (blocker_id = (select auth.uid()));

grant select on safety.reports to authenticated;
create policy "own reports" on safety.reports
  for select to authenticated using (reporter_id = (select auth.uid()));

grant select on safety.moderation_actions to authenticated;
create policy "actions about me" on safety.moderation_actions
  for select to authenticated using (subject_user_id = (select auth.uid()));
-- Writes for all safety tables go through api functions (tasks D5, D6, G2 to G4).
