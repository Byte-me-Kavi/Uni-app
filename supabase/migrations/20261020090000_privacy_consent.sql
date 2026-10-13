-- Privacy controls and the consent centre.
--
--   Per-field visibility   each student chooses who sees their photo, their "about" and their batch
--                          on their card and in search: everyone, their university, their batch or
--                          no one. Defaults keep today's behaviour (everyone who can find them).
--                          Freshers' photos stay batch-only whatever they choose (shielding).
--   Batch directory        opt-in: a list of batchmates who chose to appear, asked once when the
--                          student joins their batch with equal Yes and Not now buttons (consent
--                          purpose batch_directory, recorded like every other consent). Freshers
--                          see names and programme only, no photos.
--   Consent centre         every purpose with the version the student agreed to and when; optional
--                          ones (analytics, digest email, batch directory) switch on and off, each
--                          change a new row. When a required policy changes version, the app asks
--                          once to accept the new one (api.accept_policies).

alter table identity.privacy_settings
  add column photo_visible_to text not null default 'everyone'
    check (photo_visible_to in ('everyone', 'my_institution', 'my_cohort', 'nobody')),
  add column bio_visible_to text not null default 'everyone'
    check (bio_visible_to in ('everyone', 'my_institution', 'my_cohort', 'nobody')),
  add column batch_visible_to text not null default 'everyone'
    check (batch_visible_to in ('everyone', 'my_institution', 'my_cohort', 'nobody'));

insert into identity.consent_purposes (code, description, current_version, required) values
  ('batch_directory', 'Appears in their batch directory', 'v1', false)
on conflict (code) do nothing;

-- Whether p_viewer may see a field the owner shows to p_level.
create or replace function identity.field_visible(p_level text, p_owner uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_owner = p_viewer or case coalesce(p_level, 'everyone')
    when 'everyone' then true
    when 'my_institution' then exists (
      select 1 from identity.profiles a join identity.profiles b on b.institution_id = a.institution_id
      where a.user_id = p_owner and b.user_id = p_viewer)
    when 'my_cohort' then exists (
      select 1 from academics.cohort_members a join academics.cohort_members b on b.cohort_id = a.cohort_id
      where a.user_id = p_owner and b.user_id = p_viewer)
    else false
  end;
$$;
revoke execute on function identity.field_visible(text, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Cards and search follow the choices
-- ---------------------------------------------------------------------------------------------

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
      when not identity.field_visible(s.photo_visible_to, p.user_id, v_uid) then null
      else p.avatar_path end,
    'bio', case when identity.field_visible(s.bio_visible_to, p.user_id, v_uid) then p.bio end,
    'institution', jsonb_build_object('name', i.name, 'short_name', i.short_name),
    'batch', case when c.id is null or not identity.field_visible(s.batch_visible_to, p.user_id, v_uid) then null
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
  left join identity.privacy_settings s on s.user_id = p.user_id
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
      -- Someone in the batch directory is visible to their batchmates.
      or (v_cohort is not null and m.cohort_id = v_cohort and s.show_in_cohort_directory)
    );

  return v_result;
end;
$$;

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
  corrected boolean,
  blocked boolean
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
  select p.user_id, p.full_name,
    case when identity.field_visible(s.photo_visible_to, p.user_id, v_uid) then p.avatar_path end,
    coalesce(i.short_name, i.name),
    case when identity.field_visible(s.batch_visible_to, p.user_id, v_uid) then pr.name end,
    case when identity.field_visible(s.batch_visible_to, p.user_id, v_uid) then c.intake_year::integer end,
    case
      when v_cohort is not null and m.cohort_id = v_cohort then 'batchmate'
      when p.institution_id = v_institution then 'university'
    end,
    v_corrected,
    exists (select 1 from safety.blocks b where b.blocker_id = v_uid and b.blocked_id = p.user_id)
  from unnest(v_ids) with ordinality as f (id, n)
  join identity.profiles p on p.user_id = f.id
  join identity.institutions i on i.id = p.institution_id
  left join identity.privacy_settings s on s.user_id = p.user_id
  left join academics.cohort_members m on m.user_id = p.user_id
  left join academics.cohorts c on c.id = m.cohort_id
  left join academics.programmes pr on pr.id = c.programme_id
  order by f.n;
end;
$$;
revoke execute on function api.search_people(text) from public, anon;
grant execute on function api.search_people(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Per-field visibility
-- ---------------------------------------------------------------------------------------------

create or replace function api.profile_visibility()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('photo', s.photo_visible_to, 'bio', s.bio_visible_to, 'batch', s.batch_visible_to,
                            'directory', s.show_in_cohort_directory)
  from identity.privacy_settings s where s.user_id = (select auth.uid());
$$;
revoke execute on function api.profile_visibility() from public, anon;
grant execute on function api.profile_visibility() to authenticated;

create or replace function api.set_field_visibility(p_field text, p_level text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_level not in ('everyone', 'my_institution', 'my_cohort', 'nobody') then
    raise exception 'Choose everyone, your university, your batch or no one.' using errcode = '22023';
  end if;
  if p_field = 'photo' then
    update identity.privacy_settings set photo_visible_to = p_level where user_id = (select auth.uid());
  elsif p_field = 'bio' then
    update identity.privacy_settings set bio_visible_to = p_level where user_id = (select auth.uid());
  elsif p_field = 'batch' then
    update identity.privacy_settings set batch_visible_to = p_level where user_id = (select auth.uid());
  else
    raise exception 'Unknown field.' using errcode = '22023';
  end if;
  return api.profile_visibility();
end;
$$;
revoke execute on function api.set_field_visibility(text, text) from public, anon;
grant execute on function api.set_field_visibility(text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Consent centre
-- ---------------------------------------------------------------------------------------------

create or replace function api.my_consents()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select distinct on (c.purpose_code) c.purpose_code, c.granted, c.policy_version, c.recorded_at
    from identity.consents c
    where c.user_id = (select auth.uid())
    order by c.purpose_code, c.recorded_at desc
  )
  select jsonb_build_object(
    'purposes', coalesce(jsonb_agg(jsonb_build_object(
      'code', cp.code,
      'required', cp.required,
      'version', cp.current_version,
      'granted', coalesce(l.granted, false),
      'decided', l.purpose_code is not null,
      'agreed_version', l.policy_version,
      'recorded_at', l.recorded_at
    ) order by cp.required desc, cp.code), '[]'::jsonb),
    'needs_reconsent', coalesce(bool_or(cp.required and (l.policy_version is distinct from cp.current_version or not coalesce(l.granted, false))), false)
  )
  from identity.consent_purposes cp
  left join latest l on l.purpose_code = cp.code;
$$;
revoke execute on function api.my_consents() from public, anon;
grant execute on function api.my_consents() to authenticated;

-- An optional consent switched on or off (each change is a new row: the proof if anyone asks).
create or replace function api.set_consent(p_code text, p_granted boolean, p_where text default 'settings')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_purpose identity.consent_purposes;
begin
  select * into v_purpose from identity.consent_purposes cp where cp.code = p_code;
  if v_uid is null or not exists (select 1 from identity.profiles p where p.user_id = v_uid) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if v_purpose.code is null then
    raise exception 'Unknown consent.' using errcode = '22023';
  end if;
  if v_purpose.required then
    raise exception 'This one is needed to use Uni Era. To withdraw it, delete your account.' using errcode = '22023';
  end if;
  if p_where not in ('settings', 'prompt') then
    raise exception 'Unknown source.' using errcode = '22023';
  end if;
  -- clock_timestamp: two changes in one transaction still have an order.
  insert into identity.consents (user_id, purpose_code, policy_version, granted, source, recorded_at)
  values (v_uid, p_code, v_purpose.current_version, coalesce(p_granted, false), p_where, clock_timestamp());
  if p_code = 'batch_directory' then
    update identity.privacy_settings set show_in_cohort_directory = coalesce(p_granted, false) where user_id = v_uid;
  end if;
  return api.my_consents();
end;
$$;
revoke execute on function api.set_consent(text, boolean, text) from public, anon;
grant execute on function api.set_consent(text, boolean, text) to authenticated;

-- The student read the updated required policies and accepts them.
create or replace function api.accept_policies()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not exists (select 1 from identity.profiles p where p.user_id = v_uid) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  insert into identity.consents (user_id, purpose_code, policy_version, granted, source, recorded_at)
  select v_uid, cp.code, cp.current_version, true, 'prompt', clock_timestamp()
  from identity.consent_purposes cp
  where cp.required and not exists (
    select 1 from (
      select distinct on (c.purpose_code) c.granted, c.policy_version from identity.consents c
      where c.user_id = v_uid and c.purpose_code = cp.code order by c.purpose_code, c.recorded_at desc
    ) l where l.granted and l.policy_version = cp.current_version);
  return api.my_consents();
end;
$$;
revoke execute on function api.accept_policies() from public, anon;
grant execute on function api.accept_policies() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Batch directory
-- ---------------------------------------------------------------------------------------------

create or replace function api.batch_directory()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cohort bigint;
  v_fresher boolean;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select m.cohort_id into v_cohort from academics.cohort_members m where m.user_id = v_uid;
  if v_cohort is null then
    raise exception 'Join your batch first.' using errcode = '22023';
  end if;
  v_fresher := identity.is_fresher(v_uid);
  return jsonb_build_object(
    'batch', academics.batch_name(v_cohort),
    'asked', exists (select 1 from identity.consents c where c.user_id = v_uid and c.purpose_code = 'batch_directory'),
    'listed', (select s.show_in_cohort_directory from identity.privacy_settings s where s.user_id = v_uid),
    'members', academics.cohort_size(v_cohort),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', p.user_id,
        'full_name', p.full_name,
        -- Freshers see names only; everyone else as the person chose.
        'avatar_path', case when v_fresher or not identity.field_visible(s.photo_visible_to, p.user_id, v_uid) then null
                            else p.avatar_path end,
        'fresher', p.account_kind = 'fresher',
        'you', p.user_id = v_uid
      ) order by p.full_name)
      from academics.cohort_members m
      join identity.profiles p on p.user_id = m.user_id and p.account_status = 'active' and p.name_confirmed_at is not null
      join identity.privacy_settings s on s.user_id = p.user_id and s.show_in_cohort_directory
      where m.cohort_id = v_cohort
        and not exists (select 1 from safety.blocks b
                        where (b.blocker_id = p.user_id and b.blocked_id = v_uid) or (b.blocker_id = v_uid and b.blocked_id = p.user_id))
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function api.batch_directory() from public, anon;
grant execute on function api.batch_directory() to authenticated;
