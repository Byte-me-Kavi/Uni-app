-- 1. Blocking stays visible to the person who blocked. Search lists students you blocked, marked
--    as blocked, and their card says so with an Unblock button, so a block can be found and undone
--    where you expect it. A student who blocked you stays invisible to you everywhere, and their
--    card is simply "not available": a block is never revealed to the person blocked.
-- 2. Student-facing messages say "the Uni Era team": accounts are approved and changed by the Uni
--    Era admins, not by moderators at each university.

-- Search keeps students you blocked (they are marked in api.search_people) and still drops
-- students who blocked you.
create or replace function identity.find_people(p_me uuid, p_institution bigint, p_cohort bigint, p_words text[])
returns uuid[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_patterns text[] := array(select '% ' || w || '%' from unnest(p_words) w);
  v_kind smallint := least(cardinality(p_words), 2);
  -- One word: its prefix. Two or more: the first word complete, then the start of the second.
  v_key text := array_to_string(p_words[1:2], ' ');
  v_hi text := v_key || chr(1114111);
  v_more boolean := cardinality(p_words) > 2;
  v_probe text;
  v_ids uuid[];
begin
  select array_agg(x.user_id order by x.tier, x.key) into v_ids from (
    select c.user_id, min(c.tier) as tier, min(c.key) as key
    from (
      (select m.user_id, 0 as tier, p.search_name as key
        from academics.cohort_members m
        join identity.profiles p on p.user_id = m.user_id
        where m.cohort_id = p_cohort
          and p.search_name like all (v_patterns)
          and exists (select 1 from identity.search_keys k where k.user_id = m.user_id)
        order by p.search_name
        limit 20)
      union all
      (select k.user_id, 1, k.key
        from identity.search_keys k
        where k.institution_id = p_institution and k.kind = v_kind and k.key >= v_key and k.key < v_hi
          and (not v_more or exists (
            select 1 from identity.profiles p where p.user_id = k.user_id and p.search_name like all (v_patterns)))
        order by k.key
        limit 20)
      union all
      (select k.user_id, 2, k.key
        from identity.search_keys k
        where k.national and k.kind = v_kind and k.key >= v_key and k.key < v_hi
          and (not v_more or exists (
            select 1 from identity.profiles p where p.user_id = k.user_id and p.search_name like all (v_patterns)))
        order by k.key
        limit 20)
    ) c
    where c.user_id <> p_me
      and not exists (select 1 from safety.blocks b where b.blocker_id = c.user_id and b.blocked_id = p_me)
    group by c.user_id
    order by min(c.tier), min(c.key)
    limit 8
  ) x;
  v_ids := coalesce(v_ids, '{}');

  -- Words out of name order ("munasinghe kav") or a shortened first word ("kav mun"): look up the
  -- longest word and check the rest against the full name. The first 300 keys per tier are the
  -- budget, so this stays bounded however common the word is.
  if cardinality(v_ids) < 8 and cardinality(p_words) > 1 then
    select w into v_probe from unnest(p_words) w order by char_length(w) desc limit 1;
    select array_agg(x.user_id order by x.tier, x.key) into v_ids from (
      select c.user_id, min(c.tier) as tier, min(c.key) as key
      from (
        select f.id as user_id, -1 as tier, lpad(f.n::text, 4, '0') as key
        from unnest(v_ids) with ordinality as f (id, n)
        union all
        (select t.user_id, 1, t.key
          from (select k.user_id, k.key from identity.search_keys k
                where k.institution_id = p_institution and k.kind = 1
                  and k.key >= v_probe and k.key < v_probe || chr(1114111)
                order by k.key limit 300) t
          join identity.profiles p on p.user_id = t.user_id and p.search_name like all (v_patterns)
          limit 20)
        union all
        (select t.user_id, 2, t.key
          from (select k.user_id, k.key from identity.search_keys k
                where k.national and k.kind = 1
                  and k.key >= v_probe and k.key < v_probe || chr(1114111)
                order by k.key limit 300) t
          join identity.profiles p on p.user_id = t.user_id and p.search_name like all (v_patterns)
          limit 20)
      ) c
      where c.user_id <> p_me
        and not exists (select 1 from safety.blocks b where b.blocker_id = c.user_id and b.blocked_id = p_me)
      group by c.user_id
      order by min(c.tier), min(c.key)
      limit 8
    ) x;
    v_ids := coalesce(v_ids, '{}');
  end if;

  return v_ids;
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
  select p.user_id, p.full_name, p.avatar_path, coalesce(i.short_name, i.name), pr.name, c.intake_year::integer,
    case
      when v_cohort is not null and m.cohort_id = v_cohort then 'batchmate'
      when p.institution_id = v_institution then 'university'
    end,
    v_corrected,
    exists (select 1 from safety.blocks b where b.blocker_id = v_uid and b.blocked_id = p.user_id)
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

-- A student's card. For a student you blocked: only name and photo, with blocked = true, so the app
-- can show "You blocked ..." and Unblock. Null when the student is not visible to you or blocked you.
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
    'avatar_path', p.avatar_path,
    'bio', p.bio,
    'institution', jsonb_build_object('name', i.name, 'short_name', i.short_name),
    'batch', case when c.id is null then null
      else jsonb_build_object('name', academics.batch_name(c.id), 'programme', pr.name, 'intake_year', c.intake_year) end,
    'relation', case
      when p.user_id = v_uid then 'you'
      when v_cohort is not null and m.cohort_id = v_cohort then 'batchmate'
      when p.institution_id = v_institution then 'university'
    end,
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
      or exists (select 1 from identity.search_keys k
                 where k.user_id = p.user_id and (k.national or k.institution_id = v_institution))
    );

  return v_result;
end;
$$;

create or replace function api.set_my_name(p_full_name text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := btrim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g'));
  v_confirmed timestamptz;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select p.name_confirmed_at into v_confirmed from identity.profiles p where p.user_id = v_uid for update;
  if v_confirmed is not null then
    raise exception 'Your name is already set. Contact the Uni Era team if it needs changing.' using errcode = '22023';
  end if;

  if char_length(v_name) not between 2 and 80 then
    raise exception 'Enter your name (2 to 80 characters).' using errcode = '22023';
  end if;
  if v_name ~ '[][0-9@#$%^&*_=+<>/\\|{}~`!?:;"]' or v_name !~ '[[:alpha:]஀-௿඀-෿]' then
    raise exception 'Use letters only: your name as it is at your university.' using errcode = '22023';
  end if;

  update identity.profiles p set full_name = v_name, name_confirmed_at = now() where p.user_id = v_uid;
  return v_name;
end;
$$;


create or replace function api.join_batch(
  p_programme_id bigint default null,
  p_programme_name text default null,
  p_intake_year integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint;
  v_parsed record;
  v_programme_id bigint;
  v_programme_name text;
  v_suggested bigint;
  v_cohort_id bigint;
  v_conversation_id uuid;
  v_name text := btrim(regexp_replace(coalesce(p_programme_name, ''), '\s+', ' ', 'g'));
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select p.institution_id into v_institution from identity.profiles p where p.user_id = v_uid;

  if exists (select 1 from academics.cohort_members m where m.user_id = v_uid) then
    raise exception 'You are already in a batch. Contact the Uni Era team if it needs changing.' using errcode = '22023';
  end if;

  if p_intake_year is null or p_intake_year not between 2000 and extract(year from now())::integer + 1 then
    raise exception 'Choose your intake year.' using errcode = '22023';
  end if;

  if p_programme_id is not null then
    -- Follow a merge to the programme it now lives under.
    select coalesce(pr.merged_into_id, pr.id) into v_programme_id
    from academics.programmes pr
    where pr.id = p_programme_id and pr.institution_id = v_institution;
    if v_programme_id is null then
      raise exception 'That programme is not at your university.' using errcode = '22023';
    end if;
  else
    if char_length(v_name) not between 2 and 120 then
      raise exception 'Type your degree programme (2 to 120 characters).' using errcode = '22023';
    end if;
    insert into academics.programmes (institution_id, name, created_by)
    values (v_institution, v_name, v_uid)
    on conflict (institution_id, name_key) do nothing;
    select coalesce(pr.merged_into_id, pr.id) into v_programme_id
    from academics.programmes pr
    where pr.institution_id = v_institution
      and pr.name_key = lower(regexp_replace(v_name, '[^[:alnum:]]+', '', 'g'));
  end if;

  select pr.name into v_programme_name from academics.programmes pr where pr.id = v_programme_id;

  insert into academics.cohorts (programme_id, intake_year)
  values (v_programme_id, p_intake_year)
  on conflict (programme_id, intake_year) do nothing;
  select c.id into v_cohort_id from academics.cohorts c
  where c.programme_id = v_programme_id and c.intake_year = p_intake_year;

  -- Compare with what the email suggested, and learn from the choice.
  select * into v_parsed from identity.parse_student_email((select auth.jwt() ->> 'email'));
  if v_parsed.email_code is not null then
    select ec.programme_id into v_suggested
    from academics.programme_email_codes ec
    join academics.programmes pr on pr.id = ec.programme_id
    where ec.email_code = v_parsed.email_code and pr.institution_id = v_institution and pr.merged_into_id is null
    order by ec.confirmations desc, pr.id
    limit 1;

    insert into academics.programme_email_codes (email_code, programme_id, confirmations)
    values (v_parsed.email_code, v_programme_id, 1)
    on conflict (email_code, programme_id)
    do update set confirmations = academics.programme_email_codes.confirmations + 1;
  end if;

  insert into academics.cohort_members (user_id, cohort_id, matches_email)
  values (
    v_uid,
    v_cohort_id,
    case
      when v_parsed.intake_year is null then null
      else v_parsed.intake_year = p_intake_year and (v_suggested is null or v_suggested = v_programme_id)
    end
  );

  -- The batch's group chat, created by the first student to join.
  insert into messaging.conversations (kind, cohort_id, created_by)
  values ('cohort', v_cohort_id, v_uid)
  on conflict (cohort_id) do nothing;
  select c.id into v_conversation_id from messaging.conversations c where c.cohort_id = v_cohort_id;

  insert into messaging.conversation_members (conversation_id, user_id)
  values (v_conversation_id, v_uid)
  on conflict do nothing;

  return jsonb_build_object(
    'name', academics.batch_name(v_cohort_id),
    'programme', v_programme_name,
    'intake_year', p_intake_year,
    'members', academics.cohort_size(v_cohort_id)
  );
end;
$$;

