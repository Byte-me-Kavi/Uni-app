-- Batches built by students, not by admins.
--
-- 1. The student's email suggests a programme code and intake year (2023cs115 -> "cs", 2023;
--    bandara-cs22050 -> "cs", 2022).
-- 2. If students at the same university have already linked that code to a programme, the app
--    suggests it and the student confirms with one tap.
-- 3. Otherwise the student types their programme. Existing batches at their university are
--    suggested as they type (with member counts) so spellings converge; a new name creates a new
--    programme.
-- 4. Every confirmation teaches the code -> programme link for the next student.
-- A batch (cohort) is programme + intake year. Joining one adds the student to its group chat,
-- created on first join.

-- ---------------------------------------------------------------------------------------------
-- Programmes belong to an institution directly. Faculty becomes optional (moderators can attach
-- one later); when set, it must be at the same institution.
-- ---------------------------------------------------------------------------------------------
alter table academics.programmes add column institution_id bigint references identity.institutions (id) on delete cascade;
update academics.programmes p set institution_id = f.institution_id from academics.faculties f where f.id = p.faculty_id;
alter table academics.programmes alter column institution_id set not null;
alter table academics.programmes alter column faculty_id drop not null;

do $$
declare
  v_name text;
begin
  -- Drop the old unique (faculty_id, name) and the old faculty foreign key, whatever they are named.
  for v_name in
    select conname from pg_constraint
    where conrelid = 'academics.programmes'::regclass and contype in ('u', 'f')
      and pg_get_constraintdef(oid) like '%faculty_id%'
  loop
    execute format('alter table academics.programmes drop constraint %I', v_name);
  end loop;
end $$;

alter table academics.faculties add constraint faculties_id_institution_key unique (id, institution_id);
alter table academics.programmes
  add constraint programmes_faculty_same_institution
  foreign key (faculty_id, institution_id) references academics.faculties (id, institution_id)
  on delete set null (faculty_id);

alter table academics.programmes
  add column name_key text generated always as (lower(regexp_replace(name, '[^[:alnum:]]+', '', 'g'))) stored,
  add column created_by uuid references identity.profiles (user_id) on delete set null,
  add column created_at timestamptz not null default now(),
  -- Set by a moderator when two spellings of the same programme are merged.
  add column merged_into_id bigint references academics.programmes (id) on delete set null;

alter table academics.programmes drop constraint if exists programmes_name_check;
alter table academics.programmes add constraint programmes_name_check
  check (char_length(btrim(name)) between 2 and 120 and name !~ '[<>{}\[\]\\]');

alter table academics.programmes add constraint programmes_institution_name_key unique (institution_id, name_key);
create index programmes_faculty_idx on academics.programmes (faculty_id);
create index programmes_created_by_idx on academics.programmes (created_by);
create index programmes_merged_into_idx on academics.programmes (merged_into_id);
create index programmes_name_trgm_idx on academics.programmes using gin (name extensions.gin_trgm_ops);

-- Email code -> programme links, learned from students' confirmations. The institution comes from
-- the programme, so it is not repeated here.
create table academics.programme_email_codes (
  email_code text not null check (email_code ~ '^[a-z]{2,5}$'),
  programme_id bigint not null references academics.programmes (id) on delete cascade,
  confirmations integer not null default 0 check (confirmations >= 0),
  primary key (email_code, programme_id)
);
create index programme_email_codes_programme_idx on academics.programme_email_codes (programme_id);
alter table academics.programme_email_codes enable row level security;
-- No grants: read and written only by the api functions below.

-- Whether the batch a student chose matches what their email suggested; mismatches are for
-- moderators to look at (e.g. a senior joining a fresher batch).
alter table academics.cohort_members add column matches_email boolean;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- Reads a programme code and intake year from a student email's local part, when present.
--   2023cs115        -> ('cs', 2023)
--   bandara-cs22050  -> ('cs', 2022)
create or replace function identity.parse_student_email(p_email text, out email_code text, out intake_year integer)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local text := lower(split_part(coalesce(p_email, ''), '@', 1));
  v_max integer := extract(year from now())::integer + 1;
  v_match text[];
begin
  -- A four-digit year, e.g. 2023cs115.
  v_match := regexp_match(v_local, '(20[0-9]{2})([a-z]{2,5})?');
  if v_match is not null and v_match[1]::integer between 2000 and v_max then
    intake_year := v_match[1]::integer;
    email_code := v_match[2];
  end if;

  -- Letters then a two-digit year at the end, e.g. cs22050.
  if intake_year is null then
    v_match := regexp_match(v_local, '([a-z]{2,5})([0-9]{2})[0-9]*$');
    if v_match is not null and 2000 + v_match[2]::integer between 2000 and v_max then
      email_code := v_match[1];
      intake_year := 2000 + v_match[2]::integer;
    end if;
  end if;
end;
$$;

-- Number of students in a batch. Counts only; it never reveals who they are.
create or replace function academics.cohort_size(p_cohort_id bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from academics.cohort_members m where m.cohort_id = p_cohort_id;
$$;
grant execute on function academics.cohort_size(bigint) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- api
-- ---------------------------------------------------------------------------------------------

-- What the caller's email suggests, and the caller's current batch if they have one.
create or replace function api.batch_suggestion()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint;
  v_parsed record;
  v_programme_id bigint;
  v_programme_name text;
  v_current jsonb;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select p.institution_id into v_institution from identity.profiles p where p.user_id = v_uid;
  select * into v_parsed from identity.parse_student_email((select auth.jwt() ->> 'email'));

  select jsonb_build_object('programme', pr.name, 'intake_year', c.intake_year, 'members', academics.cohort_size(c.id))
    into v_current
  from academics.cohort_members m
  join academics.cohorts c on c.id = m.cohort_id
  join academics.programmes pr on pr.id = c.programme_id
  where m.user_id = v_uid;

  if v_parsed.email_code is not null then
    select pr.id, pr.name into v_programme_id, v_programme_name
    from academics.programme_email_codes ec
    join academics.programmes pr on pr.id = ec.programme_id
    where ec.email_code = v_parsed.email_code
      and pr.institution_id = v_institution
      and pr.merged_into_id is null
    order by ec.confirmations desc, pr.id
    limit 1;
  end if;

  return jsonb_build_object(
    'email_code', v_parsed.email_code,
    'intake_year', v_parsed.intake_year,
    'programme', case when v_programme_id is not null then jsonb_build_object(
      'id', v_programme_id,
      'name', v_programme_name,
      'members', coalesce((
        select academics.cohort_size(c.id) from academics.cohorts c
        where c.programme_id = v_programme_id and c.intake_year = v_parsed.intake_year
      ), 0)
    ) end,
    'current_batch', v_current
  );
end;
$$;
grant execute on function api.batch_suggestion() to authenticated;

-- Programmes at the caller's university matching what they type, best match first, with how many
-- students are in that programme's batch for the given year.
create or replace function api.search_programmes(p_query text, p_intake_year integer default null)
returns table (id bigint, name text, members integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint;
  v_query text := btrim(coalesce(p_query, ''));
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select p.institution_id into v_institution from identity.profiles p where p.user_id = v_uid;

  return query
  select pr.id, pr.name,
    coalesce((
      select academics.cohort_size(c.id) from academics.cohorts c
      where c.programme_id = pr.id and c.intake_year = p_intake_year
    ), 0) as members
  from academics.programmes pr
  where pr.institution_id = v_institution
    and pr.merged_into_id is null
    and (
      char_length(v_query) < 2
      or pr.name ilike '%' || v_query || '%'
      or extensions.similarity(pr.name, v_query) > 0.25
    )
  -- Ordinal positions: the output column names are also PL/pgSQL variables in this function.
  order by
    case when char_length(v_query) < 2 then 0 else extensions.similarity(pr.name, v_query) end desc,
    3 desc,
    2
  limit 8;
end;
$$;
grant execute on function api.search_programmes(text, integer) to authenticated;

-- Joins the caller to a batch: an existing programme (p_programme_id) or a typed one
-- (p_programme_name, matched by normalised name or created). Creates the batch and its group chat
-- on first join. One batch per student; changing it later goes through a moderator.
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
    raise exception 'You are already in a batch. Ask a moderator if it needs changing.' using errcode = '22023';
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
    'programme', v_programme_name,
    'intake_year', p_intake_year,
    'members', academics.cohort_size(v_cohort_id)
  );
end;
$$;
grant execute on function api.join_batch(bigint, text, integer) to authenticated;

-- Home screen: add the caller's batch.
create or replace function api.my_home()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'full_name', p.full_name,
    'account_status', p.account_status,
    'institution', jsonb_build_object('name', i.name, 'short_name', i.short_name),
    'staff_role', (
      select case when bool_or(s.role = 'admin') then 'admin' when bool_or(s.role = 'moderator') then 'moderator' end
      from identity.staff_roles s
      where s.user_id = p.user_id
    ),
    'has_cohort', exists (select 1 from academics.cohort_members c where c.user_id = p.user_id),
    'batch', (
      select jsonb_build_object('programme', pr.name, 'intake_year', c.intake_year, 'members', academics.cohort_size(c.id))
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
