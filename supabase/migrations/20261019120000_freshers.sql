-- Fresher accounts.
--
-- Freshers get their university email weeks after UGC selections, but need their batch from the
-- day selections come out. A fresher signs up with a personal email, confirms it with a code and
-- uploads their selection letter; a national admin reads the letter and places them in their real
-- batch (university, programme, intake year). From then on they are in the batch chat like anyone,
-- with a few limits, until they add their university email, which makes them a normal student.
--
--   Sign-up        the sign-up hook accepts any email when the app says it is a fresher (and the
--                  email is not a university one). The profile has no university yet.
--   Letter         stored in its own private R2 bucket by the letters function; staff open it
--                  through 5-minute links, each view audited. Kept until the fresher verifies
--                  their university email, is rejected, or their fresher time runs out, then
--                  deleted (identity.letter_deletions, emptied by the letters function).
--   Approval       api.review_fresher: university, programme and intake year, optionally the letter
--                  number (kept only as a hash, so one letter cannot make two accounts). The batch
--                  and its chat are created if needed; a new batch starts in the 'freshers' stage.
--   Limits         freshers cannot post or comment, use the Shop, publish files, host kuppi or make
--                  groups (triggers, so every path is covered). They read the feed, like, chat and
--                  share files in chats.
--   Shielding      only batchmates find a fresher in search or see their photo; anyone else (seniors
--                  included) reaches them through a message request; the national programme group
--                  waits until they verify.
--   Upgrade        changing the login email to a university email of their university (Supabase
--                  email change) makes the account a student account (trigger on auth.users).
--   Expiry         120 days without a university email: is_active_user() turns false and the app
--                  asks for the email. Nothing is deleted; admins can extend.

-- ---------------------------------------------------------------------------------------------
-- 1. Accounts
-- ---------------------------------------------------------------------------------------------

alter table identity.profiles
  add column account_kind text not null default 'student' check (account_kind in ('student', 'fresher')),
  -- Freshers only: when the account stops working without a university email.
  add column fresher_until timestamptz;

-- A fresher waiting for approval has no university yet; everyone else has one.
alter table identity.profiles alter column institution_id drop not null;
alter table identity.profiles add constraint profiles_institution_known
  check (institution_id is not null or (account_kind = 'fresher' and account_status in ('pending', 'rejected')));

-- Active, and (for freshers) still within their time. Used by nearly every api function.
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
      and (p.account_kind = 'student' or p.fresher_until > now())
  );
$$;

create or replace function identity.is_fresher(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from identity.profiles p where p.user_id = p_user_id and p.account_kind = 'fresher');
$$;
revoke execute on function identity.is_fresher(uuid) from public, anon;
grant execute on function identity.is_fresher(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. Applications and letters
-- ---------------------------------------------------------------------------------------------

create table identity.fresher_applications (
  user_id uuid primary key references identity.profiles (user_id) on delete cascade,
  -- needs_letter: nothing uploaded yet, or asked to upload again. waiting: a checked letter is
  -- waiting for an admin. approved: in their batch as a fresher. verified: now a student.
  status text not null default 'needs_letter'
    check (status in ('needs_letter', 'waiting', 'approved', 'rejected', 'verified', 'expired')),
  letter_path text unique check (letter_path ~ '^letters/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|pdf)$'),
  letter_mime text check (letter_mime in ('image/jpeg', 'application/pdf')),
  letter_size integer check (letter_size > 0),
  letter_sha256 text check (letter_sha256 ~ '^[0-9a-f]{64}$'),
  -- The upload in progress, until the letters function has checked it.
  upload_path text unique check (upload_path ~ '^letters/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|pdf)$'),
  upload_mime text check (upload_mime in ('image/jpeg', 'application/pdf')),
  upload_size integer check (upload_size between 1 and 10000000),
  -- The number printed on the letter, hashed: one letter, one account.
  letter_number_hash text,
  -- Why it was not approved, or why to upload again. Shown to the fresher.
  reason text check (char_length(reason) between 3 and 300),
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references identity.profiles (user_id) on delete set null,
  created_at timestamptz not null default now()
);
create index fresher_applications_waiting_idx on identity.fresher_applications (submitted_at, user_id)
  where status = 'waiting';
create index fresher_applications_sha_idx on identity.fresher_applications (letter_sha256)
  where letter_sha256 is not null;
create unique index fresher_applications_number_key on identity.fresher_applications (letter_number_hash)
  where letter_number_hash is not null;
create index fresher_applications_decided_by_idx on identity.fresher_applications (decided_by);
alter table identity.fresher_applications enable row level security;
-- No policies: read and written only through api functions.

-- Ambassadors: verified seniors who answer freshers' questions, one university each, appointed by
-- its moderators (api.set_ambassador, with freshers' questions). Shown with a badge.
create table identity.ambassadors (
  user_id uuid primary key references identity.profiles (user_id) on delete cascade,
  institution_id bigint not null references identity.institutions (id) on delete cascade,
  appointed_by uuid references identity.profiles (user_id) on delete set null,
  appointed_at timestamptz not null default now()
);
create index ambassadors_institution_idx on identity.ambassadors (institution_id);
create index ambassadors_appointed_by_idx on identity.ambassadors (appointed_by);
alter table identity.ambassadors enable row level security;

-- Letters to delete from the bucket. The letters function empties it (cron, below).
create table identity.letter_deletions (
  path text primary key,
  queued_at timestamptz not null default now()
);
alter table identity.letter_deletions enable row level security;

-- Queues the fresher's letter (and any unfinished upload) for deletion and forgets the paths.
create or replace function identity.forget_letter(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into identity.letter_deletions (path)
  select x from identity.fresher_applications a, unnest(array[a.letter_path, a.upload_path]) x
  where a.user_id = p_user_id and x is not null
  on conflict do nothing;
  update identity.fresher_applications
  set letter_path = null, letter_mime = null, letter_size = null, upload_path = null, upload_mime = null, upload_size = null
  where user_id = p_user_id;
end;
$$;
revoke execute on function identity.forget_letter(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Sign-up
-- ---------------------------------------------------------------------------------------------

grant usage on schema ops to supabase_auth_admin;
grant execute on function ops.feature_on(text) to supabase_auth_admin;

create or replace function identity.before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_email text := lower(btrim(event -> 'user' ->> 'email'));
  v_meta jsonb := coalesce(event -> 'user' -> 'user_metadata', '{}'::jsonb);
  v_fresher boolean := v_meta -> 'fresher' = 'true'::jsonb;
  v_domain text;
  v_status text;
begin
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400, 'message', case when v_fresher then 'Enter your email address.' else 'Use your university student email address.' end));
  end if;

  if v_meta -> 'age_confirmed' is distinct from 'true'::jsonb
     or v_meta -> 'guidelines_accepted' is distinct from 'true'::jsonb then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400, 'message', 'Confirm you are 18 or older and accept the community guidelines.'));
  end if;

  v_domain := split_part(v_email, '@', 2);
  select i.status into v_status
  from identity.institution_email_domains d
  join identity.institutions i on i.id = d.institution_id
  where d.domain = v_domain;

  if v_fresher then
    if not ops.feature_on('feature.fresher_signup') then
      return jsonb_build_object('error', jsonb_build_object(
        'http_code', 403, 'message', 'Fresher sign-up is paused for now. Try again later.'));
    end if;
    if v_status is not null then
      return jsonb_build_object('error', jsonb_build_object(
        'http_code', 400, 'message', 'That is a university email. Use the normal sign-up with it instead.'));
    end if;
    return '{}'::jsonb;
  end if;

  if not ops.feature_on('feature.signup') then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Sign-up is paused for now. Try again later.'));
  end if;

  if v_status is null or v_status = 'disabled' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Use your university student email address. No university email yet? Join as a fresher.'));
  end if;

  if v_status <> 'live' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Uni Era is not open at your university yet. We will let you know when it is.'));
  end if;

  return '{}'::jsonb;
end;
$$;

create or replace function identity.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institution_id bigint;
  v_fresher boolean := new.raw_user_meta_data -> 'fresher' = 'true'::jsonb;
  -- The student types their name after approval. Until then the profile holds a name given at
  -- sign-up (accounts created by the team) or the email's local part, and is not searchable.
  v_name text := nullif(btrim(regexp_replace(coalesce(new.raw_user_meta_data ->> 'full_name', ''), '\s+', ' ', 'g')), '');
  v_local text := split_part(lower(new.email), '@', 1);
  -- rpad also truncates, so pad only names shorter than the 2-character minimum.
  v_placeholder text := left(rpad(v_local, greatest(char_length(v_local), 2), '_'), 80);
begin
  if char_length(v_name) not between 2 and 80 then
    v_name := null;
  end if;

  select d.institution_id into v_institution_id
  from identity.institution_email_domains d
  where d.domain = split_part(lower(new.email), '@', 2);

  if v_institution_id is null and not v_fresher then
    -- Only reachable if the before_user_created hook is switched off. Fail closed.
    raise exception 'email domain is not a registered institution domain'
      using errcode = 'check_violation';
  end if;

  if v_institution_id is not null then
    v_fresher := false;
  end if;

  insert into identity.profiles (user_id, institution_id, full_name, account_kind)
  values (new.id, v_institution_id,
          -- A personal email's local part is not shown to anyone, but it is not a name either.
          case when v_fresher then coalesce(v_name, 'New fresher') else coalesce(v_name, v_placeholder) end,
          case when v_fresher then 'fresher' else 'student' end);

  insert into identity.privacy_settings (user_id) values (new.id);

  insert into identity.consents (user_id, purpose_code, policy_version, granted, source)
  select new.id, cp.code, cp.current_version, true, 'signup'
  from identity.consent_purposes cp
  where cp.required;

  if v_fresher then
    insert into identity.fresher_applications (user_id) values (new.id);
  end if;

  return new;
end;
$$;

create or replace function identity.custom_access_token(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id uuid := (event ->> 'user_id')::uuid;
  v_claims jsonb := event -> 'claims';
  v_status text;
  v_institution_id bigint;
  v_staff_role text;
  v_name_confirmed boolean;
  v_kind text;
  v_until timestamptz;
begin
  select p.account_status, p.institution_id, p.name_confirmed_at is not null, p.account_kind, p.fresher_until
    into v_status, v_institution_id, v_name_confirmed, v_kind, v_until
  from identity.profiles p
  where p.user_id = v_user_id;

  select case
           when bool_or(s.role = 'admin') then 'admin'
           when bool_or(s.role = 'moderator') then 'moderator'
         end
    into v_staff_role
  from identity.staff_roles s
  where s.user_id = v_user_id;

  if jsonb_typeof(v_claims -> 'app_metadata') is distinct from 'object' then
    v_claims := jsonb_set(v_claims, '{app_metadata}', '{}'::jsonb);
  end if;

  v_claims := jsonb_set(v_claims, '{app_metadata,account_status}', to_jsonb(coalesce(v_status, 'pending')));
  v_claims := jsonb_set(v_claims, '{app_metadata,institution_id}', coalesce(to_jsonb(v_institution_id), 'null'::jsonb));
  v_claims := jsonb_set(v_claims, '{app_metadata,staff_role}', coalesce(to_jsonb(v_staff_role), 'null'::jsonb));
  v_claims := jsonb_set(v_claims, '{app_metadata,name_confirmed}', to_jsonb(coalesce(v_name_confirmed, false)));
  v_claims := jsonb_set(v_claims, '{app_metadata,account_kind}', to_jsonb(coalesce(v_kind, 'student')));
  v_claims := jsonb_set(v_claims, '{app_metadata,fresher_until}',
    coalesce(to_jsonb(extract(epoch from v_until)::bigint), 'null'::jsonb));

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

-- Approved: the fresher hears they are in. Otherwise as before.
create or replace function identity.account_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.account_status = 'active' then
    perform messaging.notify(
      array[new.user_id], 'account',
      case when old.account_status = 'suspended' then 'Your account is active again' else 'You are in!' end,
      case when old.account_status = 'suspended' then 'You can use Uni Era again.'
           when new.account_kind = 'fresher' then 'The Uni Era team checked your letter. Open the app to meet your batch.'
           else 'The Uni Era team approved your account. Open the app to find your batch.' end,
      jsonb_build_object('href', '/'), 'account', null, null, true);
  elsif new.account_status = 'rejected' then
    perform messaging.notify(
      array[new.user_id], 'account',
      'We could not approve your account',
      'Open Uni Era to see why.',
      jsonb_build_object('href', '/'), 'account', null, null, true);
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Batches: a fresher batch is the real batch, closed to seniors until it starts
-- ---------------------------------------------------------------------------------------------

alter table academics.cohorts
  add column stage text not null default 'started' check (stage in ('freshers', 'started'));

-- While a batch is in the freshers stage, a student with a university email joins it only if the
-- email's intake year is the batch's. Seniors cannot slip into a fresher batch.
create or replace function academics.guard_fresher_batch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cohort record;
  v_email_year integer;
begin
  select c.stage, c.intake_year into v_cohort from academics.cohorts c where c.id = new.cohort_id;
  if v_cohort.stage = 'freshers' and not identity.is_fresher(new.user_id) then
    select (identity.parse_student_email(u.email)).intake_year into v_email_year
    from auth.users u where u.id = new.user_id;
    if v_email_year is distinct from v_cohort.intake_year then
      raise exception 'This batch is open only to freshers of % until their university starts.', v_cohort.intake_year
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function academics.guard_fresher_batch() from public, anon, authenticated;
create trigger cohort_members_fresher_guard before insert on academics.cohort_members
  for each row execute function academics.guard_fresher_batch();

-- Joins the national group for the student's batch programme.
create or replace function messaging.join_programme_chat(p_user_id uuid, p_cohort_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_field bigint;
  v_conversation uuid;
begin
  select academics.ensure_field(co.programme_id) into v_field from academics.cohorts co where co.id = p_cohort_id;
  if v_field is null then
    return;
  end if;
  insert into messaging.conversations (kind, field_id) values ('programme', v_field) on conflict (field_id) do nothing;
  select c.id into v_conversation from messaging.conversations c where c.field_id = v_field;
  insert into messaging.conversation_members (conversation_id, user_id) values (v_conversation, p_user_id)
  on conflict do nothing;
end;
$$;
revoke execute on function messaging.join_programme_chat(uuid, bigint) from public, anon, authenticated;

-- Joining a batch also joins the national group for its field (freshers once they verify);
-- leaving the batch leaves both.
create or replace function messaging.sync_programme_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from messaging.conversation_members m
    using messaging.conversations c
    where m.conversation_id = c.id and m.user_id = old.user_id
      and (c.cohort_id = old.cohort_id or c.field_id = (
        select academics.ensure_field(co.programme_id) from academics.cohorts co where co.id = old.cohort_id));
    return null;
  end if;

  if not identity.is_fresher(new.user_id) then
    perform messaging.join_programme_chat(new.user_id, new.cohort_id);
  end if;
  return null;
end;
$$;

-- Puts a student in a batch at their university, making the programme, batch and chat if needed.
-- Used for freshers (by the admin who approves them). Returns the batch id.
create or replace function academics.place_in_batch(
  p_user_id uuid,
  p_institution_id bigint,
  p_programme_id bigint,
  p_programme_name text,
  p_intake_year integer,
  p_actor uuid
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_programme_id bigint;
  v_cohort_id bigint;
  v_conversation_id uuid;
  v_name text := btrim(regexp_replace(coalesce(p_programme_name, ''), '\s+', ' ', 'g'));
begin
  if p_programme_id is not null then
    select coalesce(pr.merged_into_id, pr.id) into v_programme_id
    from academics.programmes pr
    where pr.id = p_programme_id and pr.institution_id = p_institution_id;
    if v_programme_id is null then
      raise exception 'That programme is not at this university.' using errcode = '22023';
    end if;
  else
    if char_length(v_name) not between 2 and 120 then
      raise exception 'Type the degree programme (2 to 120 characters).' using errcode = '22023';
    end if;
    insert into academics.programmes (institution_id, name, created_by)
    values (p_institution_id, v_name, p_actor)
    on conflict (institution_id, name_key) do nothing;
    select coalesce(pr.merged_into_id, pr.id) into v_programme_id
    from academics.programmes pr
    where pr.institution_id = p_institution_id
      and pr.name_key = lower(regexp_replace(v_name, '[^[:alnum:]]+', '', 'g'));
  end if;

  -- A batch made for freshers starts closed to seniors.
  insert into academics.cohorts (programme_id, intake_year, stage)
  values (v_programme_id, p_intake_year, 'freshers')
  on conflict (programme_id, intake_year) do nothing;
  select c.id into v_cohort_id from academics.cohorts c
  where c.programme_id = v_programme_id and c.intake_year = p_intake_year;

  delete from academics.cohort_members m where m.user_id = p_user_id;
  insert into academics.cohort_members (user_id, cohort_id, matches_email) values (p_user_id, v_cohort_id, null);

  insert into messaging.conversations (kind, cohort_id, created_by)
  values ('cohort', v_cohort_id, p_user_id)
  on conflict (cohort_id) do nothing;
  select c.id into v_conversation_id from messaging.conversations c where c.cohort_id = v_cohort_id;
  insert into messaging.conversation_members (conversation_id, user_id)
  values (v_conversation_id, p_user_id)
  on conflict do nothing;

  return v_cohort_id;
end;
$$;
revoke execute on function academics.place_in_batch(uuid, bigint, bigint, text, integer, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. What freshers cannot do yet (every path: triggers on the tables)
-- ---------------------------------------------------------------------------------------------

create or replace function identity.refuse_fresher()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Chats: only groups a student makes themselves (new.kind exists only on this table).
  if tg_table_name = 'conversations' then
    if to_jsonb(new) ->> 'kind' <> 'group' then
      return new;
    end if;
  end if;
  if identity.is_fresher((select auth.uid())) then
    raise exception 'Freshers can % once they add their university email.', tg_argv[0] using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function identity.refuse_fresher() from public, anon, authenticated;

create trigger refuse_fresher before insert on feed.posts
  for each row execute function identity.refuse_fresher('post');
create trigger refuse_fresher before insert on feed.comments
  for each row execute function identity.refuse_fresher('comment');
create trigger refuse_fresher before insert on shop.listings
  for each row execute function identity.refuse_fresher('sell in the Shop');
create trigger refuse_fresher before insert on shop.orders
  for each row execute function identity.refuse_fresher('order from the Shop');
create trigger refuse_fresher before insert on shop.interests
  for each row execute function identity.refuse_fresher('use the Shop');
create trigger refuse_fresher before insert on content.resources
  for each row execute function identity.refuse_fresher('share files with the university');
create trigger refuse_fresher before insert on kuppi.sessions
  for each row execute function identity.refuse_fresher('host a kuppi');
create trigger refuse_fresher before insert on messaging.conversations
  for each row execute function identity.refuse_fresher('make groups');

-- ---------------------------------------------------------------------------------------------
-- 6. Shielding freshers from seniors
-- ---------------------------------------------------------------------------------------------

-- Search keys: a fresher's keys carry institution 0 (no university), so the university and
-- national searches never match them; only the batch search, which scans the searcher's own
-- batch, finds them.
create or replace function identity.sync_search_keys(p_user_id uuid, p_removing boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institution bigint;
  v_full_name text;
  v_findable text;
  v_fresher boolean;
  v_old text[];
  v_new text[] := '{}';
begin
  select coalesce(array_agg(k.key), '{}') into v_old
  from identity.search_keys k where k.user_id = p_user_id and k.kind = 1;
  delete from identity.search_keys k where k.user_id = p_user_id;

  if not p_removing then
    select p.institution_id, p.full_name,
      case when p.account_status = 'active' and p.name_confirmed_at is not null
        then coalesce(s.findable_by, 'everyone') else 'nobody' end,
      p.account_kind = 'fresher'
    into v_institution, v_full_name, v_findable, v_fresher
    from identity.profiles p
    left join identity.privacy_settings s on s.user_id = p.user_id
    where p.user_id = p_user_id;
  end if;

  if v_findable in ('everyone', 'my_institution') then
    if v_fresher then
      v_institution := 0;
      v_findable := 'my_institution';
    end if;
    v_new := identity.name_words(v_full_name);
    insert into identity.search_keys (user_id, institution_id, kind, national, key)
    select p_user_id, v_institution, 1, v_findable = 'everyone', w from unnest(v_new) w
    union all
    select p_user_id, v_institution, 2, v_findable = 'everyone', v_new[i] || ' ' || v_new[j]
    from generate_series(1, least(cardinality(v_new), 5)) i,
         generate_series(1, least(cardinality(v_new), 5)) j
    where i < j;
  end if;

  update identity.search_words w set people = w.people - 1
  where w.word = any (v_old) and not w.word = any (v_new);
  delete from identity.search_words w where w.people = 0 and w.word = any (v_old);
  insert into identity.search_words as w (word, people)
  select x, 1 from unnest(v_new) x where not x = any (v_old)
  on conflict (word) do update set people = w.people + 1;
end;
$$;

drop trigger profiles_search_keys_update on identity.profiles;
create trigger profiles_search_keys_update
  after update of full_name, account_status, institution_id, name_confirmed_at, account_kind on identity.profiles
  for each row
  when (old.full_name is distinct from new.full_name
    or old.account_status is distinct from new.account_status
    or old.institution_id is distinct from new.institution_id
    or old.name_confirmed_at is distinct from new.name_confirmed_at
    or old.account_kind is distinct from new.account_kind)
  execute function identity.search_keys_trigger();

-- A student's card. Freshers: only batchmates see the card's photo, and only batchmates and people
-- they already chat with can open it at all.
create or replace function api.person(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint;
  v_cohort bigint;
  v_result jsonb;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  if exists (select 1 from safety.blocks b where b.blocker_id = p_user_id and b.blocked_id = v_uid) then
    return null;
  end if;

  if exists (select 1 from safety.blocks b where b.blocker_id = v_uid and b.blocked_id = p_user_id) then
    return (
      select jsonb_build_object('user_id', p.user_id, 'full_name', p.full_name, 'avatar_path', p.avatar_path, 'blocked', true)
      from identity.profiles p where p.user_id = p_user_id
    );
  end if;

  select p.institution_id, m.cohort_id into v_institution, v_cohort
  from identity.profiles p
  left join academics.cohort_members m on m.user_id = p.user_id
  where p.user_id = v_uid;

  select jsonb_build_object(
    'user_id', p.user_id,
    'full_name', p.full_name,
    'avatar_path', case
      when p.account_kind = 'fresher' and p.user_id <> v_uid and m.cohort_id is distinct from v_cohort then null
      else p.avatar_path end,
    'bio', p.bio,
    'institution', jsonb_build_object('name', i.name, 'short_name', i.short_name),
    'batch', case when c.id is null then null
      else jsonb_build_object('name', academics.batch_name(c.id), 'programme', pr.name, 'intake_year', c.intake_year) end,
    'relation', case
      when p.user_id = v_uid then 'you'
      when v_cohort is not null and m.cohort_id = v_cohort then 'batchmate'
      when p.institution_id = v_institution then 'university'
    end,
    'fresher', p.account_kind = 'fresher',
    'ambassador', exists (select 1 from identity.ambassadors am where am.user_id = p.user_id),
    -- Moderators of the student's university may make them an ambassador.
    'can_appoint', p.user_id <> v_uid and p.account_kind = 'student' and identity.is_staff_for(p.institution_id),
    'blocked', false
  ) into v_result
  from identity.profiles p
  join identity.institutions i on i.id = p.institution_id
  left join academics.cohort_members m on m.user_id = p.user_id
  left join academics.cohorts c on c.id = m.cohort_id
  left join academics.programmes pr on pr.id = c.programme_id
  where p.user_id = p_user_id
    and (
      p.user_id = v_uid
      or (p.account_kind = 'student' and exists (
            select 1 from identity.search_keys k
            where k.user_id = p.user_id and (k.national or k.institution_id = v_institution)))
      or (p.account_kind = 'fresher' and (
            (v_cohort is not null and m.cohort_id = v_cohort)
            or exists (select 1 from messaging.direct_conversations d
                       where d.user_low = least(v_uid, p.user_id) and d.user_high = greatest(v_uid, p.user_id))))
    );

  return v_result;
end;
$$;

-- Direct messages: a fresher and anyone outside their batch start as a request, even at the same
-- university, so seniors reach freshers only when the fresher accepts.
create or replace function api.start_direct(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_me record;
  v_them record;
  v_setting text;
  v_low uuid;
  v_high uuid;
  v_conversation uuid;
  v_status text;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_user_id is null or p_user_id = v_uid then
    raise exception 'You cannot message yourself.' using errcode = '22023';
  end if;

  select p.user_id, p.full_name, p.institution_id, p.account_status, p.account_kind, m.cohort_id into v_them
  from identity.profiles p left join academics.cohort_members m on m.user_id = p.user_id
  where p.user_id = p_user_id;
  if v_them.user_id is null or v_them.account_status <> 'active'
     or exists (select 1 from safety.blocks b
                where (b.blocker_id = v_uid and b.blocked_id = p_user_id) or (b.blocker_id = p_user_id and b.blocked_id = v_uid)) then
    raise exception 'You cannot message this student.' using errcode = '42501';
  end if;

  v_low := least(v_uid, p_user_id);
  v_high := greatest(v_uid, p_user_id);
  select d.conversation_id, d.request_status into v_conversation, v_status
  from messaging.direct_conversations d where d.user_low = v_low and d.user_high = v_high;
  if v_conversation is not null then
    return jsonb_build_object('conversation_id', v_conversation, 'request_status', v_status);
  end if;

  select p.institution_id, p.account_kind, m.cohort_id into v_me
  from identity.profiles p left join academics.cohort_members m on m.user_id = p.user_id
  where p.user_id = v_uid;
  select coalesce(s.who_can_message, 'my_institution') into v_setting
  from identity.privacy_settings s where s.user_id = p_user_id;
  v_setting := coalesce(v_setting, 'my_institution');

  if v_setting = 'nobody'
     or (v_setting = 'my_cohort' and (v_me.cohort_id is null or v_me.cohort_id is distinct from v_them.cohort_id))
     or (v_setting = 'my_institution' and v_me.institution_id is distinct from v_them.institution_id) then
    raise exception '% is not accepting messages from you.', split_part(v_them.full_name, ' ', 1) using errcode = '42501';
  end if;

  v_status := case
    when v_me.institution_id is distinct from v_them.institution_id then 'pending'
    when (v_me.account_kind = 'fresher' or v_them.account_kind = 'fresher')
         and (v_me.cohort_id is null or v_me.cohort_id is distinct from v_them.cohort_id) then 'pending'
    else 'accepted'
  end;
  insert into messaging.conversations (kind, created_by) values ('direct', v_uid) returning id into v_conversation;
  insert into messaging.direct_conversations (conversation_id, user_low, user_high, initiated_by, request_status)
  values (v_conversation, v_low, v_high, v_uid, v_status)
  on conflict (user_low, user_high) do nothing;
  if not found then
    -- Someone opened the same chat a moment ago: use theirs.
    delete from messaging.conversations c where c.id = v_conversation;
    select d.conversation_id, d.request_status into v_conversation, v_status
    from messaging.direct_conversations d where d.user_low = v_low and d.user_high = v_high;
    return jsonb_build_object('conversation_id', v_conversation, 'request_status', v_status);
  end if;
  insert into messaging.conversation_members (conversation_id, user_id) values (v_conversation, v_uid), (v_conversation, p_user_id);
  return jsonb_build_object('conversation_id', v_conversation, 'request_status', v_status);
end;
$$;

-- Adding someone to a group: as before, and a fresher outside the adder's batch only after an
-- accepted direct chat (a senior cannot pull freshers into a group).
create or replace function messaging.can_add(p_adder uuid, p_target uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_them record;
  v_setting text;
begin
  if p_target is null or p_target = p_adder then
    return false;
  end if;
  select p.institution_id, m.cohort_id into v_me
  from identity.profiles p left join academics.cohort_members m on m.user_id = p.user_id
  where p.user_id = p_adder;
  select p.institution_id, p.account_status, p.account_kind, m.cohort_id into v_them
  from identity.profiles p left join academics.cohort_members m on m.user_id = p.user_id
  where p.user_id = p_target;
  if v_them.account_status is distinct from 'active'
     or exists (select 1 from safety.blocks b
                where (b.blocker_id = p_adder and b.blocked_id = p_target) or (b.blocker_id = p_target and b.blocked_id = p_adder)) then
    return false;
  end if;
  select coalesce(s.who_can_message, 'my_institution') into v_setting from identity.privacy_settings s where s.user_id = p_target;
  v_setting := coalesce(v_setting, 'my_institution');
  if v_setting = 'nobody'
     or (v_setting = 'my_cohort' and (v_me.cohort_id is null or v_me.cohort_id is distinct from v_them.cohort_id))
     or (v_setting = 'my_institution' and v_me.institution_id is distinct from v_them.institution_id) then
    return false;
  end if;
  if v_me.institution_id is distinct from v_them.institution_id
     or (v_them.account_kind = 'fresher' and v_me.cohort_id is distinct from v_them.cohort_id) then
    return exists (
      select 1 from messaging.direct_conversations d
      where d.user_low = least(p_adder, p_target) and d.user_high = greatest(p_adder, p_target)
        and d.request_status = 'accepted'
    );
  end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 7. The fresher's side
-- ---------------------------------------------------------------------------------------------

-- Where the fresher's application stands, for the waiting screen and Home.
create or replace function api.my_fresher()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', a.status,
    'has_letter', a.letter_path is not null,
    'reason', a.reason,
    'submitted_at', a.submitted_at,
    'fresher_until', p.fresher_until,
    'email', u.email,
    'institution', (select jsonb_build_object('id', i.id, 'name', i.name, 'short_name', i.short_name)
                    from identity.institutions i where i.id = p.institution_id),
    'domains', (select coalesce(jsonb_agg(d.domain order by d.domain), '[]'::jsonb)
                from identity.institution_email_domains d where d.institution_id = p.institution_id)
  )
  from identity.profiles p
  join identity.fresher_applications a on a.user_id = p.user_id
  join auth.users u on u.id = p.user_id
  where p.user_id = (select auth.uid()) and p.account_kind = 'fresher';
$$;
revoke execute on function api.my_fresher() from public, anon;
grant execute on function api.my_fresher() to authenticated;

-- Reserves a path for the letter: a JPEG photo or a PDF, up to 10 MB. Allowed while waiting for
-- the first decision, or when asked to upload again.
create or replace function api.begin_letter_upload(p_mime text, p_size integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
  v_path text;
  v_old text;
begin
  select a.status, a.upload_path into v_status, v_old
  from identity.fresher_applications a
  join identity.profiles p on p.user_id = a.user_id
  where a.user_id = v_uid and p.account_status = 'pending'
  for update of a;
  if v_status is null or v_status not in ('needs_letter', 'waiting') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_mime not in ('image/jpeg', 'application/pdf') then
    raise exception 'Upload a photo or a PDF of the letter.' using errcode = '22023';
  end if;
  if p_size is null or p_size not between 1 and 10000000 then
    raise exception 'The letter must be under 10 MB.' using errcode = '22023';
  end if;
  perform messaging.hit_limit('letter_upload', 10, 'Too many uploads today. Try again tomorrow.');

  if v_old is not null then
    insert into identity.letter_deletions (path) values (v_old) on conflict do nothing;
  end if;
  v_path := format('letters/%s/%s.%s', v_uid, gen_random_uuid(), case when p_mime = 'application/pdf' then 'pdf' else 'jpg' end);
  update identity.fresher_applications
  set upload_path = v_path, upload_mime = p_mime, upload_size = p_size
  where user_id = v_uid;
  return jsonb_build_object('path', v_path, 'mime', p_mime, 'size', p_size);
end;
$$;
revoke execute on function api.begin_letter_upload(text, integer) from public, anon;
grant execute on function api.begin_letter_upload(text, integer) to authenticated;

-- The caller's upload waiting for its check (letters function, with the fresher's token).
create or replace function api.letter_upload_to_check(p_path text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('path', a.upload_path, 'mime', a.upload_mime, 'size', a.upload_size)
  from identity.fresher_applications a
  where a.user_id = (select auth.uid()) and a.upload_path = p_path;
$$;
revoke execute on function api.letter_upload_to_check(text) from public, anon;
grant execute on function api.letter_upload_to_check(text) to authenticated;

-- The letters function's verdict (service role). A good letter replaces the old one and joins the
-- queue; a bad one is forgotten (the function deletes the file).
create or replace function api.letter_upload_checked(p_path text, p_ok boolean, p_sha256 text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_app identity.fresher_applications;
begin
  select * into v_app from identity.fresher_applications a where a.upload_path = p_path for update;
  if not found then
    return;
  end if;
  if not p_ok then
    update identity.fresher_applications set upload_path = null, upload_mime = null, upload_size = null
    where user_id = v_app.user_id;
    return;
  end if;
  if v_app.letter_path is not null then
    insert into identity.letter_deletions (path) values (v_app.letter_path) on conflict do nothing;
  end if;
  update identity.fresher_applications
  set letter_path = v_app.upload_path, letter_mime = v_app.upload_mime, letter_size = v_app.upload_size,
      letter_sha256 = p_sha256, upload_path = null, upload_mime = null, upload_size = null,
      status = 'waiting', reason = null, submitted_at = now()
  where user_id = v_app.user_id;
end;
$$;
revoke execute on function api.letter_upload_checked(text, boolean, text) from public, anon, authenticated;
grant execute on function api.letter_upload_checked(text, boolean, text) to service_role;

-- Before changing the login email: is this a university email of the fresher's university, and
-- free? Works for freshers whose time has run out too (that is when they need it most).
create or replace function api.check_university_email(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_institution bigint;
  v_domain_institution bigint;
begin
  select p.institution_id into v_institution
  from identity.profiles p
  where p.user_id = v_uid and p.account_kind = 'fresher' and p.account_status = 'active';
  if v_institution is null then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter your university email address.' using errcode = '22023';
  end if;
  select d.institution_id into v_domain_institution
  from identity.institution_email_domains d where d.domain = split_part(v_email, '@', 2);
  if v_domain_institution is null then
    raise exception 'That is not a university email. Use the one your university gave you.' using errcode = '22023';
  end if;
  if v_domain_institution <> v_institution then
    raise exception 'That email is from another university. Use the one from %.',
      (select i.name from identity.institutions i where i.id = v_institution) using errcode = '22023';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email and u.id <> v_uid) then
    raise exception 'That email already has a Uni Era account. Contact the Uni Era team if it is yours.' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function api.check_university_email(text) from public, anon;
grant execute on function api.check_university_email(text) to authenticated;

-- The login email changed (both codes confirmed). A university email of the fresher's university
-- makes them a student: the limits lift, the national group opens and the letter is deleted.
create or replace function identity.email_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
  v_cohort record;
  v_year integer;
begin
  select p.user_id, p.institution_id into v_profile
  from identity.profiles p
  where p.user_id = new.id and p.account_kind = 'fresher' and p.institution_id is not null;
  if v_profile.user_id is null then
    return null;
  end if;
  if not exists (select 1 from identity.institution_email_domains d
                 where d.domain = split_part(lower(new.email), '@', 2) and d.institution_id = v_profile.institution_id) then
    return null;
  end if;

  update identity.profiles set account_kind = 'student', fresher_until = null where user_id = new.id;
  perform identity.forget_letter(new.id);
  update identity.fresher_applications set status = 'verified' where user_id = new.id;

  select m.cohort_id, c.intake_year into v_cohort
  from academics.cohort_members m join academics.cohorts c on c.id = m.cohort_id
  where m.user_id = new.id;
  if v_cohort.cohort_id is not null then
    v_year := (identity.parse_student_email(new.email)).intake_year;
    update academics.cohort_members set matches_email = case when v_year is null then null else v_year = v_cohort.intake_year end
    where user_id = new.id;
    perform messaging.join_programme_chat(new.id, v_cohort.cohort_id);
  end if;

  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (new.id, 'fresher.verified', 'identity.profiles', new.id::text, jsonb_build_object('domain', split_part(lower(new.email), '@', 2)));

  perform messaging.notify(
    array[new.id], 'account', 'You are verified',
    'Your university email is confirmed. Posting, the Shop and kuppi are open to you now.',
    jsonb_build_object('href', '/'), 'account', null, null, true);
  return null;
end;
$$;
revoke execute on function identity.email_changed() from public, anon, authenticated;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function identity.email_changed();

-- ---------------------------------------------------------------------------------------------
-- 8. The admin's side (national admins)
-- ---------------------------------------------------------------------------------------------

-- Freshers waiting, oldest first, with signs worth a second look: the same file used by another
-- account, and earlier letters asked again.
create or replace function api.fresher_queue(
  p_after_submitted_at timestamptz default null,
  p_after_user_id uuid default null,
  p_limit integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not identity.is_national_admin() then
    raise exception 'Only national admins approve freshers.' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(x order by x.submitted_at, x.user_id), '[]'::jsonb)
    from (
      select a.user_id, a.submitted_at, a.letter_mime as mime, a.letter_size as size, u.email, p.created_at as registered_at,
        (select count(*)::integer from identity.fresher_applications o
         where o.letter_sha256 = a.letter_sha256 and o.user_id <> a.user_id) as same_file
      from identity.fresher_applications a
      join identity.profiles p on p.user_id = a.user_id
      join auth.users u on u.id = a.user_id
      where a.status = 'waiting' and p.account_status = 'pending'
        and (p_after_submitted_at is null
             or (a.submitted_at, a.user_id) > (p_after_submitted_at, coalesce(p_after_user_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      order by a.submitted_at, a.user_id
      limit least(greatest(coalesce(p_limit, 30), 1), 50)
    ) x
  );
end;
$$;
revoke execute on function api.fresher_queue(timestamptz, uuid, integer) from public, anon;
grant execute on function api.fresher_queue(timestamptz, uuid, integer) to authenticated;

-- The letter's path, for the letters function to sign a 5-minute link. Every view is audited.
create or replace function api.fresher_letter(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not identity.is_national_admin() then
    raise exception 'Only national admins see letters.' using errcode = '42501';
  end if;
  select jsonb_build_object('path', a.letter_path, 'mime', a.letter_mime) into v_result
  from identity.fresher_applications a where a.user_id = p_user_id and a.letter_path is not null;
  if v_result is null then
    raise exception 'There is no letter for this account.' using errcode = 'P0002';
  end if;
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values ((select auth.uid()), 'letter.view', 'identity.fresher_applications', p_user_id::text, '{}'::jsonb);
  return v_result;
end;
$$;
revoke execute on function api.fresher_letter(uuid) from public, anon;
grant execute on function api.fresher_letter(uuid) to authenticated;

-- Universities and programmes for the approval form.
create or replace function api.admin_programmes(p_institution_id bigint default null, p_query text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := btrim(coalesce(p_query, ''));
begin
  if not identity.is_national_admin() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_institution_id is null then
    return (
      select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'short_name', i.short_name) order by i.name), '[]'::jsonb)
      from identity.institutions i where i.status = 'live'
    );
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name)), '[]'::jsonb)
    from (
      select pr.id, pr.name
      from academics.programmes pr
      where pr.institution_id = p_institution_id and pr.merged_into_id is null
        and (char_length(v_query) < 2 or pr.name ilike '%' || v_query || '%' or extensions.similarity(pr.name, v_query) > 0.25)
      order by case when char_length(v_query) < 2 then 0 else extensions.similarity(pr.name, v_query) end desc, pr.name
      limit 8
    ) x
  );
end;
$$;
revoke execute on function api.admin_programmes(bigint, text) from public, anon;
grant execute on function api.admin_programmes(bigint, text) to authenticated;

-- Approve (university, programme, intake year), ask for the letter again, or reject.
create or replace function api.review_fresher(
  p_user_id uuid,
  p_decision text,
  p_institution_id bigint default null,
  p_programme_id bigint default null,
  p_programme_name text default null,
  p_intake_year integer default null,
  p_letter_number text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_reason text := nullif(btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g')), '');
  v_number text := nullif(upper(regexp_replace(coalesce(p_letter_number, ''), '[^[:alnum:]]', '', 'g')), '');
  v_hash text;
  v_app identity.fresher_applications;
  v_cohort bigint;
  v_year integer := extract(year from now())::integer;
begin
  if not identity.is_national_admin() then
    raise exception 'Only national admins approve freshers.' using errcode = '42501';
  end if;
  if p_user_id = v_actor then
    raise exception 'You cannot review your own account.' using errcode = '42501';
  end if;

  select a.* into v_app
  from identity.fresher_applications a
  join identity.profiles p on p.user_id = a.user_id
  where a.user_id = p_user_id and p.account_status = 'pending'
  for update of a;
  if v_app.user_id is null or v_app.status <> 'waiting' then
    raise exception 'This fresher is not waiting for a decision.' using errcode = '22023';
  end if;

  if p_decision = 'reupload' then
    if v_reason is null or char_length(v_reason) not between 3 and 300 then
      raise exception 'Say what is wrong with the letter.' using errcode = '22023';
    end if;
    update identity.fresher_applications
    set status = 'needs_letter', reason = v_reason, decided_at = now(), decided_by = v_actor
    where user_id = p_user_id;
    insert into ops.audit_log (actor_id, action, target_table, target_id, details)
    values (v_actor, 'fresher.reupload', 'identity.fresher_applications', p_user_id::text, jsonb_build_object('reason', v_reason));
    perform messaging.notify(array[p_user_id], 'account', 'Upload your letter again', v_reason,
      jsonb_build_object('href', '/'), 'account', null, null, true);
    return jsonb_build_object('status', 'needs_letter');
  end if;

  if p_decision = 'rejected' then
    if v_reason is null or char_length(v_reason) not between 3 and 300 then
      raise exception 'A reason is required.' using errcode = '22023';
    end if;
    update identity.fresher_applications
    set status = 'rejected', reason = v_reason, decided_at = now(), decided_by = v_actor
    where user_id = p_user_id;
    perform identity.forget_letter(p_user_id);
    update identity.profiles set account_status = 'rejected' where user_id = p_user_id;
    insert into identity.account_reviews (user_id, decision, reason, reviewed_by) values (p_user_id, 'rejected', v_reason, v_actor);
    insert into ops.audit_log (actor_id, action, target_table, target_id, details)
    values (v_actor, 'fresher.rejected', 'identity.profiles', p_user_id::text, jsonb_build_object('reason', v_reason));
    return jsonb_build_object('status', 'rejected');
  end if;

  if p_decision <> 'approved' then
    raise exception 'Unknown decision.' using errcode = '22023';
  end if;

  if not exists (select 1 from identity.institutions i where i.id = p_institution_id and i.status = 'live') then
    raise exception 'Choose a university that is open on Uni Era.' using errcode = '22023';
  end if;
  if p_intake_year is null or p_intake_year not between v_year - 1 and v_year + 1 then
    raise exception 'Choose an intake year between % and %.', v_year - 1, v_year + 1 using errcode = '22023';
  end if;
  if v_number is not null then
    if char_length(v_number) not between 4 and 30 then
      raise exception 'The letter number looks wrong. Leave it empty if there is none.' using errcode = '22023';
    end if;
    v_hash := encode(pg_catalog.sha256(convert_to('uni-era-letter:' || v_number, 'UTF8')), 'hex');
    if exists (select 1 from identity.fresher_applications a where a.letter_number_hash = v_hash and a.user_id <> p_user_id) then
      raise exception 'Another account already used this letter number.' using errcode = '22023';
    end if;
  end if;

  update identity.profiles
  set institution_id = p_institution_id, account_status = 'active', fresher_until = now() + interval '120 days'
  where user_id = p_user_id;
  v_cohort := academics.place_in_batch(p_user_id, p_institution_id, p_programme_id, p_programme_name, p_intake_year, v_actor);
  update identity.fresher_applications
  set status = 'approved', reason = null, letter_number_hash = v_hash, decided_at = now(), decided_by = v_actor
  where user_id = p_user_id;
  insert into identity.account_reviews (user_id, decision, reviewed_by) values (p_user_id, 'approved', v_actor);
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_actor, 'fresher.approved', 'identity.profiles', p_user_id::text,
          jsonb_build_object('institution_id', p_institution_id, 'cohort_id', v_cohort, 'intake_year', p_intake_year));

  return jsonb_build_object('status', 'approved', 'batch', academics.batch_name(v_cohort));
end;
$$;
revoke execute on function api.review_fresher(uuid, text, bigint, bigint, text, integer, text, text) from public, anon;
grant execute on function api.review_fresher(uuid, text, bigint, bigint, text, integer, text, text) to authenticated;

-- More time for a fresher whose university is slow to issue email (staff of their university).
create or replace function api.extend_fresher(p_user_id uuid, p_days integer)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_institution bigint;
  v_until timestamptz;
begin
  select p.institution_id into v_institution
  from identity.profiles p where p.user_id = p_user_id and p.account_kind = 'fresher' and p.account_status = 'active';
  if v_institution is null or not identity.is_staff_for(v_institution) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_days not between 1 and 120 then
    raise exception 'Extend by 1 to 120 days.' using errcode = '22023';
  end if;
  update identity.profiles set fresher_until = greatest(fresher_until, now()) + make_interval(days => p_days)
  where user_id = p_user_id returning fresher_until into v_until;
  update identity.fresher_applications set status = 'approved' where user_id = p_user_id and status = 'expired';
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values ((select auth.uid()), 'fresher.extended', 'identity.profiles', p_user_id::text, jsonb_build_object('days', p_days));
  return v_until;
end;
$$;
revoke execute on function api.extend_fresher(uuid, integer) from public, anon;
grant execute on function api.extend_fresher(uuid, integer) to authenticated;

-- Batches still in the freshers stage, in the caller's staff scope.
create or replace function api.fresher_batches()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from identity.staff_roles s where s.user_id = (select auth.uid())) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', academics.batch_name(c.id), 'intake_year', c.intake_year,
      'members', academics.cohort_size(c.id),
      'freshers', (select count(*)::integer from academics.cohort_members m
                   join identity.profiles p on p.user_id = m.user_id
                   where m.cohort_id = c.id and p.account_kind = 'fresher')
    ) order by c.intake_year desc, pr.name), '[]'::jsonb)
    from academics.cohorts c
    join academics.programmes pr on pr.id = c.programme_id
    where c.stage = 'freshers' and identity.is_staff_for(pr.institution_id)
  );
end;
$$;
revoke execute on function api.fresher_batches() from public, anon;
grant execute on function api.fresher_batches() to authenticated;

-- Lectures have begun: the batch opens like any other (reps can be appointed as usual).
create or replace function api.start_batch(p_cohort_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_institution bigint;
begin
  select pr.institution_id into v_institution
  from academics.cohorts c join academics.programmes pr on pr.id = c.programme_id
  where c.id = p_cohort_id and c.stage = 'freshers';
  if v_institution is null or not identity.is_staff_for(v_institution) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update academics.cohorts set stage = 'started' where id = p_cohort_id;
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values ((select auth.uid()), 'batch.started', 'academics.cohorts', p_cohort_id::text, '{}'::jsonb);
end;
$$;
revoke execute on function api.start_batch(bigint) from public, anon;
grant execute on function api.start_batch(bigint) to authenticated;

-- The student approval queue leaves freshers out (they have their own, with letters).
create or replace function api.pending_accounts(
  p_institution_id bigint default null,
  p_after_registered_at timestamptz default null,
  p_after_user_id uuid default null,
  p_limit integer default 50
)
returns table (
  user_id uuid,
  full_name text,
  email text,
  institution_id bigint,
  institution_name text,
  registered_at timestamptz,
  email_confirmed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_national boolean;
  v_institutions bigint[];
begin
  if v_actor is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select
    coalesce(bool_or(s.role = 'admin' and s.institution_id is null), false),
    coalesce(array_agg(s.institution_id) filter (where s.institution_id is not null), '{}')
  into v_national, v_institutions
  from identity.staff_roles s
  where s.user_id = v_actor;

  if not v_national and cardinality(v_institutions) = 0 then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  if p_institution_id is not null and not v_national and not (p_institution_id = any (v_institutions)) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  return query
  select p.user_id, p.full_name, u.email::text, p.institution_id, i.name, p.created_at, u.email_confirmed_at
  from identity.profiles p
  join auth.users u on u.id = p.user_id
  join identity.institutions i on i.id = p.institution_id
  where p.account_status = 'pending'
    and p.account_kind = 'student'
    and u.email_confirmed_at is not null
    and (p_institution_id is null or p.institution_id = p_institution_id)
    and (v_national or p.institution_id = any (v_institutions))
    and (
      p_after_registered_at is null
      or (p.created_at, p.user_id) > (p_after_registered_at, coalesce(p_after_user_id, '00000000-0000-0000-0000-000000000000'::uuid))
    )
  order by p.created_at, p.user_id
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

-- Home's staff count: students waiting in the caller's scope, plus freshers for national admins.
create or replace function identity.pending_account_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_national boolean;
  v_institutions bigint[];
begin
  if v_actor is null or not (select identity.is_active_user()) then
    return null;
  end if;

  select
    coalesce(bool_or(s.role = 'admin' and s.institution_id is null), false),
    coalesce(array_agg(s.institution_id) filter (where s.institution_id is not null), '{}')
  into v_national, v_institutions
  from identity.staff_roles s
  where s.user_id = v_actor;

  if not v_national and cardinality(v_institutions) = 0 then
    return null;
  end if;

  return (
    select count(*)::integer
    from identity.profiles p
    join auth.users u on u.id = p.user_id
    where p.account_status = 'pending'
      and p.account_kind = 'student'
      and u.email_confirmed_at is not null
      and (v_national or p.institution_id = any (v_institutions))
  ) + case when v_national then (
    select count(*)::integer from identity.fresher_applications a where a.status = 'waiting'
  ) else 0 end;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 9. Deleting letters, and fresher time running out
-- ---------------------------------------------------------------------------------------------

-- For the letters function (service role): paths to delete, then confirmation they are gone.
create or replace function api.letters_to_delete(p_limit integer default 100)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(d.path), '{}') from (
    select d.path from identity.letter_deletions d order by d.queued_at limit least(greatest(p_limit, 1), 500)
  ) d;
$$;
revoke execute on function api.letters_to_delete(integer) from public, anon, authenticated;
grant execute on function api.letters_to_delete(integer) to service_role;

create or replace function api.letters_deleted(p_paths text[])
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from identity.letter_deletions d where d.path = any (p_paths);
$$;
revoke execute on function api.letters_deleted(text[]) from public, anon, authenticated;
grant execute on function api.letters_deleted(text[]) to service_role;

-- Fresher time over: the letter goes (the account stays, waiting for the university email).
create or replace function identity.expire_freshers()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  for v_user in
    select a.user_id from identity.fresher_applications a
    join identity.profiles p on p.user_id = a.user_id
    where a.status = 'approved' and p.account_kind = 'fresher' and p.fresher_until < now()
  loop
    perform identity.forget_letter(v_user);
    update identity.fresher_applications set status = 'expired' where user_id = v_user;
  end loop;
end;
$$;
revoke execute on function identity.expire_freshers() from public, anon, authenticated;

-- Asks the letters function to empty the deletion queue (Vault: letters_function_url and
-- letters_function_secret, the same value as the function's LETTERS_SECRET).
create or replace function identity.request_letter_cleanup()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from identity.letter_deletions) then
    return;
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'letters_function_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'letters_function_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('action', 'cleanup'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-letters-secret', v_secret),
    timeout_milliseconds := 30000
  );
end;
$$;
revoke execute on function identity.request_letter_cleanup() from public, anon, authenticated;

select cron.schedule('fresher-expiry', '20 19 * * *', $$select identity.expire_freshers()$$); -- 00:50 in Sri Lanka
select cron.schedule('letters-cleanup', '*/30 * * * *', $$select identity.request_letter_cleanup()$$);
