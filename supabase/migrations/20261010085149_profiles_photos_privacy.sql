-- Student profile and settings: profile photo, a short bio, who can message me, and blocking.
--
-- Photos live in Cloudflare R2, not in Postgres. The app never holds R2 keys: it asks the
-- `avatar` Edge Function for a short-lived upload URL, and the function asks this database where
-- the photo may go (api.begin_avatar_upload: the caller's own folder, rate-limited) and records it
-- once uploaded (api.set_my_avatar). Paths are random per upload, so a photo URL cannot be guessed
-- and a new photo never shows a stale cached one.

alter table identity.profiles add constraint profiles_avatar_path_format
  check (avatar_path ~ '^avatars/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$');

-- ---------------------------------------------------------------------------------------------
-- Photo
-- ---------------------------------------------------------------------------------------------

-- Where the caller's next photo goes. 20 uploads an hour is plenty for trying a few photos.
create or replace function api.begin_avatar_upload()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_hits integer;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  insert into ops.rate_limits as r (user_id, action, window_start, hits)
  values (v_uid, 'avatar_upload', date_trunc('hour', now()), 1)
  on conflict on constraint rate_limits_pkey do update set hits = r.hits + 1
  returning r.hits into v_hits;
  if v_hits > 20 then
    raise exception 'Too many photo uploads. Try again in an hour.' using errcode = 'PT429';
  end if;

  return 'avatars/' || v_uid || '/' || gen_random_uuid() || '.jpg';
end;
$$;
grant execute on function api.begin_avatar_upload() to authenticated;

-- Sets (or, with null, removes) the caller's photo. Only paths in the caller's own folder are
-- accepted, which only the upload function can write to. Returns the previous path so the
-- function can delete that file.
create or replace function api.set_my_avatar(p_path text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old text;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_path is not null and p_path !~ ('^avatars/' || v_uid || '/[0-9a-f-]{36}\.jpg$') then
    raise exception 'That photo is not yours.' using errcode = '22023';
  end if;

  select p.avatar_path into v_old from identity.profiles p where p.user_id = v_uid for update;
  update identity.profiles p set avatar_path = p_path where p.user_id = v_uid;
  return v_old;
end;
$$;
grant execute on function api.set_my_avatar(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Bio and privacy
-- ---------------------------------------------------------------------------------------------

-- A short line about yourself, up to 280 characters. Empty removes it.
create or replace function api.update_bio(p_bio text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_bio text := nullif(btrim(regexp_replace(coalesce(p_bio, ''), '\n{3,}', E'\n\n', 'g')), '');
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if char_length(v_bio) > 280 then
    raise exception 'Keep it to 280 characters.' using errcode = '22023';
  end if;
  update identity.profiles p set bio = v_bio where p.user_id = v_uid;
  return v_bio;
end;
$$;
grant execute on function api.update_bio(text) to authenticated;

-- Changes either privacy setting (null leaves it as it is). Runs as the caller: RLS limits the
-- update to their own row. Who can message me is enforced when Chats opens; the setting is
-- stored now so students choose it once.
create or replace function api.update_privacy(p_findable_by text default null, p_who_can_message text default null)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_findable_by is not null and p_findable_by not in ('everyone', 'my_institution', 'nobody') then
    raise exception 'Choose everyone, my_institution or nobody.' using errcode = '22023';
  end if;
  if p_who_can_message is not null and p_who_can_message not in ('everyone', 'my_institution', 'my_cohort', 'nobody') then
    raise exception 'Choose everyone, my_institution, my_cohort or nobody.' using errcode = '22023';
  end if;

  update identity.privacy_settings s set
    findable_by = coalesce(p_findable_by, s.findable_by),
    who_can_message = coalesce(p_who_can_message, s.who_can_message)
  where s.user_id = (select auth.uid())
  returning jsonb_build_object('findable_by', s.findable_by, 'who_can_message', s.who_can_message) into v_result;

  if v_result is null then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return v_result;
end;
$$;
grant execute on function api.update_privacy(text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Blocking. A block hides both students from each other in search and on cards (and, when Chats
-- opens, in messages). The blocked student is not told.
-- ---------------------------------------------------------------------------------------------
create or replace function api.block_user(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_user_id is null or p_user_id = v_uid then
    raise exception 'You cannot block yourself.' using errcode = '22023';
  end if;
  if not exists (select 1 from identity.profiles p where p.user_id = p_user_id) then
    raise exception 'Student not found.' using errcode = 'P0002';
  end if;
  insert into safety.blocks (blocker_id, blocked_id) values (v_uid, p_user_id) on conflict do nothing;
end;
$$;
grant execute on function api.block_user(uuid) to authenticated;

create or replace function api.unblock_user(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  delete from safety.blocks b where b.blocker_id = v_uid and b.blocked_id = p_user_id;
end;
$$;
grant execute on function api.unblock_user(uuid) to authenticated;

-- The students the caller has blocked, newest first.
create or replace function api.blocked_users()
returns table (user_id uuid, full_name text, avatar_path text, institution text, blocked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, p.full_name, p.avatar_path, coalesce(i.short_name, i.name), b.created_at
  from safety.blocks b
  join identity.profiles p on p.user_id = b.blocked_id
  join identity.institutions i on i.id = p.institution_id
  where b.blocker_id = (select auth.uid())
  order by b.created_at desc;
$$;
grant execute on function api.blocked_users() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Photos and the new settings in the screens that show a student
-- ---------------------------------------------------------------------------------------------
create or replace function api.my_account()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', p.user_id,
    'full_name', p.full_name,
    'name_confirmed', p.name_confirmed_at is not null,
    'bio', p.bio,
    'avatar_path', p.avatar_path,
    'batch', (
      select jsonb_build_object('name', academics.batch_name(m.cohort_id))
      from academics.cohort_members m where m.user_id = p.user_id
    ),
    'blocked_count', (select count(*) from safety.blocks b where b.blocker_id = p.user_id),
    'email', (select auth.jwt() ->> 'email'),
    'account_status', p.account_status,
    'institution', jsonb_build_object('id', i.id, 'name', i.name, 'short_name', i.short_name),
    'last_review', (
      select jsonb_build_object('decision', r.decision, 'reason', r.reason, 'at', r.created_at)
      from identity.account_reviews r
      where r.user_id = p.user_id
      order by r.created_at desc
      limit 1
    ),
    'staff_role', (
      select case when bool_or(s.role = 'admin') then 'admin' when bool_or(s.role = 'moderator') then 'moderator' end
      from identity.staff_roles s
      where s.user_id = p.user_id
    ),
    'findable_by', coalesce(
      (select s.findable_by from identity.privacy_settings s where s.user_id = p.user_id), 'everyone'),
    'who_can_message', coalesce(
      (select s.who_can_message from identity.privacy_settings s where s.user_id = p.user_id), 'my_institution')
  )
  from identity.profiles p
  join identity.institutions i on i.id = p.institution_id
  where p.user_id = (select auth.uid());
$$;

create or replace function api.my_home()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'full_name', p.full_name,
    'avatar_path', p.avatar_path,
    'account_status', p.account_status,
    'institution', jsonb_build_object('name', i.name, 'short_name', i.short_name),
    'staff_role', (
      select case when bool_or(s.role = 'admin') then 'admin' when bool_or(s.role = 'moderator') then 'moderator' end
      from identity.staff_roles s
      where s.user_id = p.user_id
    ),
    'has_cohort', exists (select 1 from academics.cohort_members c where c.user_id = p.user_id),
    'batch', (
      select jsonb_build_object(
      'name', academics.batch_name(c.id), 'programme', pr.name, 'intake_year', c.intake_year,
      'members', academics.cohort_size(c.id))
      from academics.cohort_members m
      join academics.cohorts c on c.id = m.cohort_id
      join academics.programmes pr on pr.id = c.programme_id
      where m.user_id = p.user_id
    ),
    'module_count', (select count(*) from academics.module_enrolments e where e.user_id = p.user_id),
    'pending_accounts', (select identity.pending_account_count())
  )
  from identity.profiles p
  join identity.institutions i on i.id = p.institution_id
  where p.user_id = (select auth.uid());
$$;

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

  select p.institution_id, m.cohort_id into v_institution, v_cohort
  from identity.profiles p
  left join academics.cohort_members m on m.user_id = p.user_id
  where p.user_id = v_uid;

  select jsonb_build_object(
    'user_id', p.user_id,
    'full_name', p.full_name,
    'avatar_path', p.avatar_path,
    'bio', p.bio,
    'institution', jsonb_build_object('name', i.name, 'short_name', i.short_name),
    'batch', case when c.id is null then null
      else jsonb_build_object('programme', pr.name, 'intake_year', c.intake_year) end,
    'relation', case
      when p.user_id = v_uid then 'you'
      when v_cohort is not null and m.cohort_id = v_cohort then 'batchmate'
      when p.institution_id = v_institution then 'university'
    end
  ) into v_result
  from identity.profiles p
  join identity.institutions i on i.id = p.institution_id
  left join academics.cohort_members m on m.user_id = p.user_id
  left join academics.cohorts c on c.id = m.cohort_id
  left join academics.programmes pr on pr.id = c.programme_id
  where p.user_id = p_user_id
    and (
      p.user_id = v_uid
      or (
        exists (select 1 from identity.search_keys k
                where k.user_id = p.user_id and (k.national or k.institution_id = v_institution))
        and not exists (select 1 from safety.blocks b where b.blocker_id = v_uid and b.blocked_id = p.user_id)
        and not exists (select 1 from safety.blocks b where b.blocker_id = p.user_id and b.blocked_id = v_uid)
      )
    );

  return v_result;
end;
$$;

-- search_people gains a column, so it is dropped and created again.
drop function api.search_people(text);
create or replace function api.search_people(p_query text)
returns table (
  user_id uuid,
  full_name text,
  avatar_path text,
  institution text,
  programme text,
  intake_year integer,
  relation text,
  corrected boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint;
  v_cohort bigint;
  v_hits integer;
  v_words text[];
  v_fixed text[];
  v_ids uuid[];
  v_corrected boolean := false;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  v_words := (array(
    select w from unnest(string_to_array(identity.search_text(left(p_query, 100)), ' ')) w where w <> ''
  ))[1:4];
  if coalesce(char_length(array_to_string(v_words, '')), 0) < 2 then
    return;
  end if;

  insert into ops.rate_limits as r (user_id, action, window_start, hits)
  values (v_uid, 'search_people', date_trunc('minute', now()), 1)
  on conflict on constraint rate_limits_pkey do update set hits = r.hits + 1
  returning r.hits into v_hits;
  if v_hits > 120 then
    raise exception 'Too many searches. Try again in a minute.' using errcode = 'PT429';
  end if;

  select p.institution_id, m.cohort_id into v_institution, v_cohort
  from identity.profiles p
  left join academics.cohort_members m on m.user_id = p.user_id
  where p.user_id = v_uid;

  v_ids := identity.find_people(v_uid, v_institution, v_cohort, v_words);
  if cardinality(v_ids) = 0 then
    v_fixed := identity.correct_words(v_words);
    if v_fixed is distinct from v_words then
      v_ids := identity.find_people(v_uid, v_institution, v_cohort, v_fixed);
      v_corrected := true;
    end if;
  end if;

  return query
  select p.user_id, p.full_name, p.avatar_path, coalesce(i.short_name, i.name), pr.name, c.intake_year::integer,
    case
      when v_cohort is not null and m.cohort_id = v_cohort then 'batchmate'
      when p.institution_id = v_institution then 'university'
    end,
    v_corrected
  from unnest(v_ids) with ordinality as f (id, n)
  join identity.profiles p on p.user_id = f.id
  join identity.institutions i on i.id = p.institution_id
  left join academics.cohort_members m on m.user_id = p.user_id
  left join academics.cohorts c on c.id = m.cohort_id
  left join academics.programmes pr on pr.id = c.programme_id
  order by f.n;
end;
$$;
grant execute on function api.search_people(text) to authenticated;
