-- Identity: institutions, accounts, staff roles, account reviews, consent and privacy settings.

create table identity.institutions (
  id bigint generated always as identity primary key,
  name text not null unique check (char_length(name) between 3 and 160),
  short_name text unique check (char_length(short_name) between 2 and 20),
  kind text not null check (kind in ('state', 'non_state', 'institute')),
  -- live: students can register; waitlist: known but not open yet; disabled: hidden.
  status text not null default 'waitlist' check (status in ('live', 'waitlist', 'disabled')),
  created_at timestamptz not null default now()
);

-- One row per student email domain. A domain belongs to exactly one institution.
create table identity.institution_email_domains (
  domain text primary key check (domain = lower(domain) and domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'),
  institution_id bigint not null references identity.institutions (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index institution_email_domains_institution_idx on identity.institution_email_domains (institution_id);

create table identity.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Fixed when the university email is verified at sign-up.
  institution_id bigint not null references identity.institutions (id) on delete restrict,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 80),
  bio text check (char_length(bio) <= 280),
  avatar_path text check (char_length(avatar_path) <= 200),
  -- Current state. Every change is also recorded in identity.account_reviews, written by the
  -- same function in the same transaction (api.review_account).
  account_status text not null default 'pending'
    check (account_status in ('pending', 'active', 'rejected', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Serves the institution foreign key and the admin approval queue (oldest pending first).
create index profiles_institution_status_created_idx
  on identity.profiles (institution_id, account_status, created_at);
create trigger profiles_touch before update on identity.profiles
  for each row execute function ops.touch_updated_at();

create table identity.staff_roles (
  id bigint generated always as identity primary key,
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  role text not null check (role in ('moderator', 'admin')),
  -- Moderators act inside one institution. Admins may be national (null) or scoped.
  institution_id bigint references identity.institutions (id) on delete cascade,
  granted_by uuid references identity.profiles (user_id) on delete set null,
  granted_at timestamptz not null default now(),
  constraint staff_roles_moderator_scoped check (role = 'admin' or institution_id is not null),
  constraint staff_roles_unique unique nulls not distinct (user_id, role, institution_id)
);
create index staff_roles_institution_idx on identity.staff_roles (institution_id);
create index staff_roles_granted_by_idx on identity.staff_roles (granted_by);

create table identity.account_reviews (
  id uuid primary key default ops.uuid_v7(),
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  decision text not null check (decision in ('approved', 'rejected', 'suspended', 'reinstated')),
  reason text check (char_length(reason) between 3 and 500),
  reviewed_by uuid references identity.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  constraint account_reviews_reason_required check (decision in ('approved', 'reinstated') or reason is not null)
);
create index account_reviews_user_created_idx on identity.account_reviews (user_id, created_at desc);
create index account_reviews_reviewed_by_idx on identity.account_reviews (reviewed_by);

create table identity.consent_purposes (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  description text not null,
  current_version text not null,
  required boolean not null default false
);
insert into identity.consent_purposes (code, description, current_version, required) values
  ('age_18_plus', 'Confirms the user is 18 or older', 'v1', true),
  ('community_guidelines', 'Accepts the community guidelines', 'v1', true),
  ('privacy_notice', 'Has been shown the privacy notice', 'v1', true),
  ('analytics', 'Allows anonymous product analytics', 'v1', false),
  ('digest_email', 'Allows the weekly digest email', 'v1', false);

-- Append-only: each change of mind is a new row; the latest row per purpose wins.
create table identity.consents (
  id uuid primary key default ops.uuid_v7(),
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  purpose_code text not null references identity.consent_purposes (code),
  policy_version text not null,
  granted boolean not null,
  source text not null check (source in ('signup', 'settings', 'prompt')),
  recorded_at timestamptz not null default now()
);
create index consents_user_purpose_idx on identity.consents (user_id, purpose_code, recorded_at desc);
create index consents_purpose_idx on identity.consents (purpose_code);

create table identity.privacy_settings (
  user_id uuid primary key references identity.profiles (user_id) on delete cascade,
  who_can_message text not null default 'my_institution'
    check (who_can_message in ('everyone', 'my_institution', 'my_cohort', 'nobody')),
  show_in_cohort_directory boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger privacy_settings_touch before update on identity.privacy_settings
  for each row execute function ops.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Helpers used by RLS policies. SECURITY DEFINER so they can read identity tables regardless of
-- the caller's own policies; each one only ever answers about the calling user.
-- Wrap calls in (select ...) inside policies so they run once per statement, not once per row.
-- ---------------------------------------------------------------------------------------------

create or replace function identity.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from identity.profiles p
    where p.user_id = (select auth.uid()) and p.account_status = 'active'
  );
$$;

create or replace function identity.current_institution_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select p.institution_id from identity.profiles p
  where p.user_id = (select auth.uid()) and p.account_status = 'active';
$$;

-- True when the caller may moderate the given institution (a moderator of it, or an admin
-- who is national or scoped to it).
create or replace function identity.is_staff_for(p_institution_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from identity.staff_roles s
    join identity.profiles p on p.user_id = s.user_id and p.account_status = 'active'
    where s.user_id = (select auth.uid())
      and (s.institution_id = p_institution_id or (s.role = 'admin' and s.institution_id is null))
  );
$$;

grant execute on function identity.is_active_user() to authenticated, service_role;
grant execute on function identity.current_institution_id() to authenticated, service_role;
grant execute on function identity.is_staff_for(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Row-level security. Tables are private (schema not exposed); these policies are the second
-- line of defence for anything reached through security-invoker api functions.
-- ---------------------------------------------------------------------------------------------

alter table identity.institutions enable row level security;
alter table identity.institution_email_domains enable row level security;
alter table identity.profiles enable row level security;
alter table identity.staff_roles enable row level security;
alter table identity.account_reviews enable row level security;
alter table identity.consent_purposes enable row level security;
alter table identity.consents enable row level security;
alter table identity.privacy_settings enable row level security;

grant select on identity.institutions, identity.consent_purposes to authenticated;
create policy "visible institutions" on identity.institutions
  for select to authenticated using (status <> 'disabled');
create policy "all purposes" on identity.consent_purposes
  for select to authenticated using (true);

grant select on identity.profiles to authenticated;
grant update (full_name, bio, avatar_path) on identity.profiles to authenticated;
create policy "own profile: read" on identity.profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own profile: update" on identity.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select on identity.staff_roles to authenticated;
create policy "own staff roles" on identity.staff_roles
  for select to authenticated using (user_id = (select auth.uid()));

grant select on identity.account_reviews to authenticated;
create policy "own reviews" on identity.account_reviews
  for select to authenticated using (user_id = (select auth.uid()));

grant select on identity.consents to authenticated;
grant insert (user_id, purpose_code, policy_version, granted, source) on identity.consents to authenticated;
create policy "own consents: read" on identity.consents
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own consents: record" on identity.consents
  for insert to authenticated with check (user_id = (select auth.uid()) and source in ('settings', 'prompt'));

grant select on identity.privacy_settings to authenticated;
grant update (who_can_message, show_in_cohort_directory) on identity.privacy_settings to authenticated;
create policy "own privacy: read" on identity.privacy_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own privacy: update" on identity.privacy_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
