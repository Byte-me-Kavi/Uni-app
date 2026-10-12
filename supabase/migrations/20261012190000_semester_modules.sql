-- Semester modules: what each batch studies, semester by semester, and a course chat per module.
--
-- Nobody adds modules one by one. Each batch keeps one short list per semester (year of study +
-- semester), and most of it is suggested:
--   * from other batches of the same programme that already listed that semester (the senior
--     batch's Year 2 Semester 1 becomes the junior batch's suggestion a year later), so each
--     programme's curriculum is typed once and then reused for every intake;
--   * (next) from module codes seen in files shared in the batch's chats.
-- A batch rep (or a moderator) confirms the list in one step. Any batchmate can add a module too:
-- it joins the batch's list once enough batchmates have added it (votes_needed: up to 3), and until
-- then it already shows for the students who added it, so nobody waits.
--
-- No duplicates:
--   * A module is identified by its university and its code, normalised: "CS 2012", "cs-2012" and
--     "CS2012" are one module (code_key). A code can never be created twice.
--   * The name is only a label. Renaming changes the same row (audited); it never makes a module.
--   * Codes that change in a curriculum revision, or duplicates that slip through, are merged by
--     moderators (merged_into_id); every list, choice and course chat follows the merge.
--   * Each batch owns its own lists. A rep's edit changes only their batch, never what another
--     batch confirmed; new batches copy the latest list as a suggestion.
--
-- The current semester comes first. Each batch stores where it is now (current_year,
-- current_semester): university calendars slip, so it is set by the batch, not computed from dates.
-- A rep sets it; batchmates can move it on to the next semester by vote. The app shows the current
-- semester's modules first and folds earlier ones away.
--
-- Course chats: one per module per intake year (students of every programme at the university who
-- take that module that year). A student is in it while the module is current for them; when the
-- batch moves on, the chat is archived for them (still readable) rather than removed.

-- ---------------------------------------------------------------------------------------------
-- Modules: the code is the identity
-- ---------------------------------------------------------------------------------------------

do $$
declare
  v_name text;
begin
  -- The old unique (institution_id, code) compared codes as typed.
  for v_name in
    select conname from pg_constraint
    where conrelid = 'academics.modules'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) like '%code%'
  loop
    execute format('alter table academics.modules drop constraint %I', v_name);
  end loop;
end $$;

update academics.modules set code = upper(btrim(regexp_replace(code, '\s+', ' ', 'g')));

alter table academics.modules
  add column code_key text generated always as (upper(regexp_replace(code, '[^[:alnum:]]+', '', 'g'))) stored,
  add column merged_into_id bigint references academics.modules (id) on delete set null,
  add column created_by uuid references identity.profiles (user_id) on delete set null,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();

alter table academics.modules
  -- Letters, then a digit, then letters or digits: CS2012, SCS2201, CO222, MA1013A.
  add constraint modules_code_key_format check (code_key ~ '^[A-Z]{1,8}[0-9][A-Z0-9]{0,11}$'),
  add constraint modules_name_clean check (char_length(btrim(name)) between 2 and 120 and name !~ '[<>{}\[\]\\]'),
  add constraint modules_not_merged_into_self check (merged_into_id is distinct from id),
  add constraint modules_institution_code_key unique (institution_id, code_key);
-- "CS20" finds CS2012, CS2022, ... as a student types.
create index modules_code_prefix_idx on academics.modules (institution_id, code_key text_pattern_ops);
create index modules_merged_into_idx on academics.modules (merged_into_id);
create index modules_created_by_idx on academics.modules (created_by);
create trigger modules_touch before update on academics.modules
  for each row execute function ops.touch_updated_at();

-- Semesters (or terms) in a year of study; most programmes have 2.
alter table academics.programmes
  add column terms_per_year smallint not null default 2 check (terms_per_year between 1 and 3);

-- Where the batch is now.
alter table academics.cohorts
  add column current_year smallint check (current_year between 1 and 7),
  add column current_semester smallint check (current_semester between 1 and 3),
  add column term_set_at timestamptz,
  add column term_set_by uuid references identity.profiles (user_id) on delete set null,
  add constraint cohorts_term_complete check ((current_year is null) = (current_semester is null));
create index cohorts_term_set_by_idx on academics.cohorts (term_set_by);

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

-- A batch's modules for one semester. A year-long module can be listed in both semesters.
create table academics.cohort_modules (
  cohort_id bigint not null references academics.cohorts (id) on delete cascade,
  year_of_study smallint not null check (year_of_study between 1 and 7),
  semester smallint not null check (semester between 1 and 3),
  module_id bigint not null references academics.modules (id) on delete cascade,
  kind text not null default 'core' check (kind in ('core', 'elective')),
  added_by uuid references identity.profiles (user_id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (cohort_id, year_of_study, semester, module_id)
);
create index cohort_modules_module_idx on academics.cohort_modules (module_id);
create index cohort_modules_added_by_idx on academics.cohort_modules (added_by);

-- Batchmates adding a module that is not on the list yet.
create table academics.cohort_module_votes (
  cohort_id bigint not null references academics.cohorts (id) on delete cascade,
  year_of_study smallint not null check (year_of_study between 1 and 7),
  semester smallint not null check (semester between 1 and 3),
  module_id bigint not null references academics.modules (id) on delete cascade,
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  kind text not null default 'core' check (kind in ('core', 'elective')),
  voted_at timestamptz not null default now(),
  primary key (cohort_id, year_of_study, semester, module_id, user_id)
);
create index cohort_module_votes_module_idx on academics.cohort_module_votes (module_id);
create index cohort_module_votes_user_idx on academics.cohort_module_votes (user_id);

-- Batchmates asking to move the batch to a semester (one open request each).
create table academics.cohort_term_votes (
  cohort_id bigint not null references academics.cohorts (id) on delete cascade,
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  year_of_study smallint not null check (year_of_study between 1 and 7),
  semester smallint not null check (semester between 1 and 3),
  voted_at timestamptz not null default now(),
  primary key (cohort_id, user_id)
);
create index cohort_term_votes_user_idx on academics.cohort_term_votes (user_id);

-- A student's own choices: the electives they take, core modules they are not taking, and modules
-- from an earlier semester they are repeating. No row means the default (core: taking; elective:
-- not taking).
create table academics.module_choices (
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  module_id bigint not null references academics.modules (id) on delete cascade,
  choice text not null check (choice in ('taking', 'not_taking', 'repeat')),
  updated_at timestamptz not null default now(),
  primary key (user_id, module_id)
);
create index module_choices_module_idx on academics.module_choices (module_id);

alter table academics.cohort_modules enable row level security;
alter table academics.cohort_module_votes enable row level security;
alter table academics.cohort_term_votes enable row level security;
alter table academics.module_choices enable row level security;
-- No grants and no policies: read and written only through the api functions below.

-- "My modules" is now derived from the batch's lists and the student's choices; the old per-student
-- enrolment table (never used by the app) goes.
drop table academics.module_enrolments;

-- Course chats: one per module per intake year.
alter table messaging.conversations add column module_intake smallint check (module_intake between 2000 and 2100);
do $$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
    where conrelid = 'messaging.conversations'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (module_id)'
  loop
    execute format('alter table messaging.conversations drop constraint %I', v_name);
  end loop;
end $$;
alter table messaging.conversations add constraint conversations_module_intake_key unique (module_id, module_intake);
alter table messaging.conversations drop constraint conversations_scope;
alter table messaging.conversations add constraint conversations_scope check (
  (kind = 'cohort') = (cohort_id is not null)
  and (kind = 'programme') = (field_id is not null)
  and (kind = 'module') = (module_id is not null)
  and (kind = 'module') = (module_intake is not null)
  and (kind = 'kuppi') = (session_id is not null)
);

-- ---------------------------------------------------------------------------------------------
-- Helpers (internal: not callable by students)
-- ---------------------------------------------------------------------------------------------

-- The caller's batch, with what the functions below need.
create or replace function academics.my_cohort()
returns table (id bigint, intake_year smallint, current_year smallint, current_semester smallint,
               term_set_at timestamptz, programme_id bigint, programme text, terms_per_year smallint,
               institution_id bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.intake_year, c.current_year, c.current_semester, c.term_set_at,
    pr.id, pr.name, pr.terms_per_year, pr.institution_id
  from academics.cohort_members m
  join academics.cohorts c on c.id = m.cohort_id
  join academics.programmes pr on pr.id = c.programme_id
  where m.user_id = (select auth.uid());
$$;

-- Reps of the batch (admins of its group chat) and the university's moderators edit its lists.
create or replace function academics.can_edit_cohort(p_cohort_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from messaging.conversations c
      join messaging.conversation_members m on m.conversation_id = c.id
      where c.cohort_id = p_cohort_id and m.user_id = (select auth.uid()) and m.role = 'admin'
    )
    or identity.is_staff_for((
      select pr.institution_id from academics.cohorts co
      join academics.programmes pr on pr.id = co.programme_id where co.id = p_cohort_id));
$$;

-- How many batchmates must agree before their change applies: half the batch, at most 3, so a
-- batch of one or two can set itself up and a big batch cannot be changed by one person.
create or replace function academics.votes_needed(p_cohort_id bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select least(3, greatest(1, (academics.cohort_size(p_cohort_id) + 1) / 2));
$$;

-- (student, module) for the modules each student of a batch takes this semester: core modules
-- unless they said they are not taking them, electives they said they take.
create or replace function academics.current_modules(p_cohort_id bigint, p_user_id uuid default null)
returns table (user_id uuid, module_id bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, cm.module_id
  from academics.cohort_members m
  join academics.cohorts c on c.id = m.cohort_id
  join academics.cohort_modules cm on cm.cohort_id = c.id
    and cm.year_of_study = c.current_year and cm.semester = c.current_semester
  left join academics.module_choices ch on ch.user_id = m.user_id and ch.module_id = cm.module_id
  where m.cohort_id = p_cohort_id
    and (p_user_id is null or m.user_id = p_user_id)
    and case cm.kind when 'core' then ch.choice is distinct from 'not_taking' else ch.choice = 'taking' end;
$$;

-- The same for every semester up to and including the current one: course chats a student keeps
-- (archived once the semester is over).
create or replace function academics.taken_modules(p_cohort_id bigint, p_user_id uuid default null)
returns table (user_id uuid, module_id bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct m.user_id, cm.module_id
  from academics.cohort_members m
  join academics.cohorts c on c.id = m.cohort_id
  join academics.cohort_modules cm on cm.cohort_id = c.id
    and (cm.year_of_study, cm.semester) <= (c.current_year, c.current_semester)
  left join academics.module_choices ch on ch.user_id = m.user_id and ch.module_id = cm.module_id
  where m.cohort_id = p_cohort_id
    and (p_user_id is null or m.user_id = p_user_id)
    and case cm.kind when 'core' then ch.choice is distinct from 'not_taking' else ch.choice = 'taking' end;
$$;

-- Puts a batch's students (or one of them) in the course chats of the modules they take now, and
-- takes them out of course chats for modules they never took. Chats of earlier semesters stay (as
-- archived). Students whose chat list changed are told to refresh it.
create or replace function academics.sync_course_chats(p_cohort_id bigint, p_user_id uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_intake smallint;
  v_added uuid[];
  v_removed uuid[];
begin
  select c.intake_year into v_intake from academics.cohorts c where c.id = p_cohort_id;
  if v_intake is null then
    return;
  end if;

  insert into messaging.conversations (kind, module_id, module_intake, title)
  select distinct 'module', w.module_id, v_intake, left(mo.code || ' · ' || mo.name, 80)
  from academics.current_modules(p_cohort_id, p_user_id) w
  join academics.modules mo on mo.id = w.module_id
  on conflict (module_id, module_intake) do nothing;

  with added as (
    insert into messaging.conversation_members (conversation_id, user_id)
    select c.id, w.user_id
    from academics.current_modules(p_cohort_id, p_user_id) w
    join messaging.conversations c on c.module_id = w.module_id and c.module_intake = v_intake
    on conflict do nothing
    returning user_id
  )
  select array_agg(distinct a.user_id) into v_added from added a;

  with kept as materialized (
    select * from academics.taken_modules(p_cohort_id, p_user_id)
  ), removed as (
    delete from messaging.conversation_members cm
    using messaging.conversations c, academics.cohort_members m
    where cm.conversation_id = c.id and c.kind = 'module' and c.module_intake = v_intake
      and m.cohort_id = p_cohort_id and m.user_id = cm.user_id
      and (p_user_id is null or m.user_id = p_user_id)
      and not exists (select 1 from kept k where k.user_id = cm.user_id and k.module_id = c.module_id)
    returning cm.user_id
  )
  select array_agg(distinct r.user_id) into v_removed from removed r;

  perform messaging.tell_users(
    array(select distinct u from unnest(coalesce(v_added, '{}') || coalesce(v_removed, '{}')) u),
    'chats', jsonb_build_object('reason', 'modules'));
end;
$$;

-- Moves a batch to a semester: earlier semesters' course chats are archived for its students, the
-- new semester's open.
create or replace function academics.apply_term(p_cohort_id bigint, p_year integer, p_semester integer, p_actor uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_intake smallint;
  v_before jsonb;
begin
  select c.intake_year, jsonb_build_object('year', c.current_year, 'semester', c.current_semester)
  into v_intake, v_before
  from academics.cohorts c where c.id = p_cohort_id for update;

  update academics.cohorts c set current_year = p_year, current_semester = p_semester,
    term_set_at = now(), term_set_by = p_actor
  where c.id = p_cohort_id;
  delete from academics.cohort_term_votes v where v.cohort_id = p_cohort_id;

  with now_taking as materialized (
    select * from academics.current_modules(p_cohort_id, null)
  )
  update messaging.conversation_members cm set
    archived_at = case when exists (select 1 from now_taking w where w.user_id = cm.user_id and w.module_id = c.module_id)
                       then null else coalesce(cm.archived_at, now()) end,
    list_pinned_at = case when exists (select 1 from now_taking w where w.user_id = cm.user_id and w.module_id = c.module_id)
                          then cm.list_pinned_at end
  from messaging.conversations c, academics.cohort_members m
  where cm.conversation_id = c.id and c.kind = 'module' and c.module_intake = v_intake
    and m.cohort_id = p_cohort_id and m.user_id = cm.user_id;

  perform academics.sync_course_chats(p_cohort_id, null);
  perform messaging.tell_users(
    array(select m.user_id from academics.cohort_members m where m.cohort_id = p_cohort_id),
    'chats', jsonb_build_object('reason', 'term'));

  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (p_actor, 'modules.set_term', 'academics.cohorts', p_cohort_id::text,
          jsonb_build_object('from', v_before, 'to', jsonb_build_object('year', p_year, 'semester', p_semester)));
end;
$$;

-- Adds a module to a batch's list once enough batchmates have added it.
create or replace function academics.apply_module_votes(
  p_cohort_id bigint, p_year integer, p_semester integer, p_module_id bigint, p_actor uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_votes integer;
  v_kind text;
begin
  select count(*), mode() within group (order by v.kind) into v_votes, v_kind
  from academics.cohort_module_votes v
  where v.cohort_id = p_cohort_id and v.year_of_study = p_year and v.semester = p_semester and v.module_id = p_module_id;
  if v_votes = 0 or v_votes < academics.votes_needed(p_cohort_id) then
    return false;
  end if;
  insert into academics.cohort_modules (cohort_id, year_of_study, semester, module_id, kind, added_by)
  values (p_cohort_id, p_year, p_semester, p_module_id, v_kind, p_actor)
  on conflict do nothing;
  delete from academics.cohort_module_votes v
  where v.cohort_id = p_cohort_id and v.year_of_study = p_year and v.semester = p_semester and v.module_id = p_module_id;
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (p_actor, 'modules.batch_added', 'academics.cohort_modules', p_cohort_id::text,
          jsonb_build_object('year', p_year, 'semester', p_semester, 'module_id', p_module_id, 'votes', v_votes));
  return true;
end;
$$;

-- The module with this code at the university (following merges), created if it is new.
create or replace function academics.ensure_module(p_institution_id bigint, p_code text, p_name text, p_actor uuid)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(regexp_replace(coalesce(p_code, ''), '\s+', ' ', 'g')));
  v_key text := upper(regexp_replace(coalesce(p_code, ''), '[^[:alnum:]]+', '', 'g'));
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_id bigint;
begin
  if v_code !~ '^[A-Z0-9 _./-]{2,20}$' or v_key !~ '^[A-Z]{1,8}[0-9][A-Z0-9]{0,11}$' then
    raise exception 'Type the module code as it is in your handbook, e.g. CS2012.' using errcode = '22023';
  end if;
  select coalesce(m.merged_into_id, m.id) into v_id
  from academics.modules m where m.institution_id = p_institution_id and m.code_key = v_key;
  if v_id is not null then
    return v_id;
  end if;

  if char_length(v_name) not between 2 and 120 or v_name ~ '[<>{}\[\]\\]' then
    raise exception 'Add the module name for %.', v_code using errcode = '22023';
  end if;
  perform messaging.hit_limit('create_module', 30, 'You have added a lot of new modules today. Try again tomorrow.');
  insert into academics.modules (institution_id, code, name, created_by)
  values (p_institution_id, v_code, v_name, p_actor)
  on conflict (institution_id, code_key) do nothing;
  select coalesce(m.merged_into_id, m.id) into v_id
  from academics.modules m where m.institution_id = p_institution_id and m.code_key = v_key;
  return v_id;
end;
$$;

-- What the app shows for a module: code, name, and the student's course chat for it, if any.
create or replace function academics.module_card(p_module_id bigint, p_user_id uuid, p_intake smallint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'code', m.code, 'name', m.name,
    'chat_id', (select c.id from messaging.conversations c
                join messaging.conversation_members cm on cm.conversation_id = c.id and cm.user_id = p_user_id
                where c.module_id = m.id and c.module_intake = p_intake))
  from academics.modules m where m.id = p_module_id;
$$;

revoke execute on function academics.my_cohort() from public, anon, authenticated;
revoke execute on function academics.can_edit_cohort(bigint) from public, anon, authenticated;
revoke execute on function academics.votes_needed(bigint) from public, anon, authenticated;
revoke execute on function academics.current_modules(bigint, uuid) from public, anon, authenticated;
revoke execute on function academics.taken_modules(bigint, uuid) from public, anon, authenticated;
revoke execute on function academics.sync_course_chats(bigint, uuid) from public, anon, authenticated;
revoke execute on function academics.apply_term(bigint, integer, integer, uuid) from public, anon, authenticated;
revoke execute on function academics.apply_module_votes(bigint, integer, integer, bigint, uuid) from public, anon, authenticated;
revoke execute on function academics.ensure_module(bigint, text, text, uuid) from public, anon, authenticated;
revoke execute on function academics.module_card(bigint, uuid, smallint) from public, anon, authenticated;

-- Joining a batch opens the course chats of its current modules; leaving it (a moderator moving a
-- student) leaves them, and drops the student's open votes in the old batch.
create or replace function academics.cohort_member_course_chats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from messaging.conversation_members cm
    using messaging.conversations c
    where cm.conversation_id = c.id and c.kind = 'module' and cm.user_id = old.user_id;
    delete from academics.cohort_module_votes v where v.cohort_id = old.cohort_id and v.user_id = old.user_id;
    delete from academics.cohort_term_votes v where v.cohort_id = old.cohort_id and v.user_id = old.user_id;
    return null;
  end if;
  perform academics.sync_course_chats(new.cohort_id, new.user_id);
  return null;
end;
$$;
revoke execute on function academics.cohort_member_course_chats() from public, anon, authenticated;
create trigger cohort_members_course_chats after insert or delete on academics.cohort_members
  for each row execute function academics.cohort_member_course_chats();

-- ---------------------------------------------------------------------------------------------
-- api: reading
-- ---------------------------------------------------------------------------------------------

-- Everything the Resources tab needs about the student's modules, in one request:
--   term       the batch's semester (or, until the batch confirms one, the semester the student
--              asked for, so they can start straight away)
--   current    modules this semester: the batch's list (core, and electives they take), modules
--              they added that are waiting for batchmates (pending), and modules they repeat
--   electives  this semester's electives, to choose from
--   not_taking core modules they said they are not taking (to undo)
--   past       earlier semesters, newest first
create or replace function api.my_modules()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_c record;
  v_vote record;
  v_year smallint;
  v_sem smallint;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v_c from academics.my_cohort();
  if v_c.id is null then
    return jsonb_build_object('batch', null);
  end if;

  select v.year_of_study, v.semester into v_vote
  from academics.cohort_term_votes v where v.cohort_id = v_c.id and v.user_id = v_uid;
  v_year := coalesce(v_c.current_year, v_vote.year_of_study);
  v_sem := coalesce(v_c.current_semester, v_vote.semester);

  return jsonb_build_object(
    'batch', jsonb_build_object('name', academics.batch_name(v_c.id), 'programme', v_c.programme, 'intake_year', v_c.intake_year),
    'can_edit', academics.can_edit_cohort(v_c.id),
    'votes_needed', academics.votes_needed(v_c.id),
    'terms_per_year', v_c.terms_per_year,
    'term', case when v_year is not null then jsonb_build_object(
      'year', v_year,
      'semester', v_sem,
      'confirmed', v_c.current_year is not null,
      'set_at', v_c.term_set_at,
      -- Days since the batch set it: after about five months the app asks whether it has ended.
      'days', (extract(epoch from now() - v_c.term_set_at) / 86400)::integer,
      'votes', case when v_c.current_year is null then (
        select count(*) from academics.cohort_term_votes v
        where v.cohort_id = v_c.id and v.year_of_study = v_year and v.semester = v_sem) end) end,
    -- A move the student asked for that the batch has not confirmed yet.
    'my_term_vote', case when v_c.current_year is not null and v_vote.year_of_study is not null then jsonb_build_object(
      'year', v_vote.year_of_study,
      'semester', v_vote.semester,
      'votes', (select count(*) from academics.cohort_term_votes v
                where v.cohort_id = v_c.id and v.year_of_study = v_vote.year_of_study and v.semester = v_vote.semester)) end,
    'current', coalesce((
      select jsonb_agg(x.card order by x.sort, x.code)
      from (
        select academics.module_card(cm.module_id, v_uid, v_c.intake_year)
                 || jsonb_build_object('kind', cm.kind, 'pending', false) as card,
               0 as sort, mo.code
        from academics.cohort_modules cm
        join academics.modules mo on mo.id = cm.module_id
        left join academics.module_choices ch on ch.user_id = v_uid and ch.module_id = cm.module_id
        where cm.cohort_id = v_c.id and cm.year_of_study = v_year and cm.semester = v_sem
          and case cm.kind when 'core' then ch.choice is distinct from 'not_taking' else ch.choice = 'taking' end
        union all
        select academics.module_card(v.module_id, v_uid, v_c.intake_year)
                 || jsonb_build_object('kind', v.kind, 'pending', true, 'votes', (
                      select count(*) from academics.cohort_module_votes v2
                      where v2.cohort_id = v.cohort_id and v2.year_of_study = v.year_of_study
                        and v2.semester = v.semester and v2.module_id = v.module_id)),
               1, mo.code
        from academics.cohort_module_votes v
        join academics.modules mo on mo.id = v.module_id
        where v.cohort_id = v_c.id and v.user_id = v_uid and v.year_of_study = v_year and v.semester = v_sem
        union all
        select academics.module_card(ch.module_id, v_uid, v_c.intake_year)
                 || jsonb_build_object('kind', 'repeat', 'pending', false),
               2, mo.code
        from academics.module_choices ch
        join academics.modules mo on mo.id = ch.module_id
        where ch.user_id = v_uid and ch.choice = 'repeat'
      ) x), '[]'::jsonb),
    'electives', coalesce((
      select jsonb_agg(academics.module_card(cm.module_id, v_uid, v_c.intake_year)
                         || jsonb_build_object('taking', coalesce(ch.choice = 'taking', false)) order by mo.code)
      from academics.cohort_modules cm
      join academics.modules mo on mo.id = cm.module_id
      left join academics.module_choices ch on ch.user_id = v_uid and ch.module_id = cm.module_id
      where cm.cohort_id = v_c.id and cm.year_of_study = v_year and cm.semester = v_sem and cm.kind = 'elective'), '[]'::jsonb),
    'not_taking', coalesce((
      select jsonb_agg(academics.module_card(cm.module_id, v_uid, v_c.intake_year) order by mo.code)
      from academics.cohort_modules cm
      join academics.modules mo on mo.id = cm.module_id
      join academics.module_choices ch on ch.user_id = v_uid and ch.module_id = cm.module_id and ch.choice = 'not_taking'
      where cm.cohort_id = v_c.id and cm.year_of_study = v_year and cm.semester = v_sem and cm.kind = 'core'), '[]'::jsonb),
    'past', coalesce((
      select jsonb_agg(jsonb_build_object('year', t.y, 'semester', t.s, 'modules', t.modules) order by t.y desc, t.s desc)
      from (
        select cm.year_of_study as y, cm.semester as s,
          jsonb_agg(academics.module_card(cm.module_id, v_uid, v_c.intake_year)
                      || jsonb_build_object('kind', cm.kind) order by mo.code) as modules
        from academics.cohort_modules cm
        join academics.modules mo on mo.id = cm.module_id
        left join academics.module_choices ch on ch.user_id = v_uid and ch.module_id = cm.module_id
        where cm.cohort_id = v_c.id and (cm.year_of_study, cm.semester) < (v_year, v_sem)
          and case cm.kind when 'core' then ch.choice is distinct from 'not_taking' else ch.choice = 'taking' end
        group by cm.year_of_study, cm.semester
      ) t), '[]'::jsonb)
  );
end;
$$;
grant execute on function api.my_modules() to authenticated;

-- One semester of the batch, for the screen where it is set up: the batch's list, modules
-- batchmates have added (with how many), and suggestions from the nearest other batch of the same
-- programme that already listed this semester.
create or replace function api.semester_plan(p_year integer, p_semester integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_c record;
  v_source record;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v_c from academics.my_cohort();
  if v_c.id is null then
    raise exception 'Join your batch first.' using errcode = '22023';
  end if;
  if p_year is null or p_semester is null or p_year not between 1 and 7 or p_semester not between 1 and 3 then
    raise exception 'Choose a year and semester.' using errcode = '22023';
  end if;

  select c.id, c.intake_year into v_source
  from academics.cohorts c
  where c.programme_id = v_c.programme_id and c.id <> v_c.id
    and exists (select 1 from academics.cohort_modules cm
                where cm.cohort_id = c.id and cm.year_of_study = p_year and cm.semester = p_semester)
  order by abs(c.intake_year - v_c.intake_year), c.intake_year desc
  limit 1;

  return jsonb_build_object(
    'year', p_year,
    'semester', p_semester,
    'can_edit', academics.can_edit_cohort(v_c.id),
    'votes_needed', academics.votes_needed(v_c.id),
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object('id', mo.id, 'code', mo.code, 'name', mo.name, 'kind', cm.kind) order by mo.code)
      from academics.cohort_modules cm
      join academics.modules mo on mo.id = cm.module_id
      where cm.cohort_id = v_c.id and cm.year_of_study = p_year and cm.semester = p_semester), '[]'::jsonb),
    'proposals', coalesce((
      select jsonb_agg(jsonb_build_object('id', mo.id, 'code', mo.code, 'name', mo.name, 'kind', p.kind,
                                          'votes', p.votes, 'mine', p.mine) order by p.votes desc, mo.code)
      from (
        select v.module_id, mode() within group (order by v.kind) as kind, count(*) as votes, bool_or(v.user_id = v_uid) as mine
        from academics.cohort_module_votes v
        where v.cohort_id = v_c.id and v.year_of_study = p_year and v.semester = p_semester
        group by v.module_id
      ) p
      join academics.modules mo on mo.id = p.module_id), '[]'::jsonb),
    'suggestions', coalesce((
      select jsonb_agg(jsonb_build_object('id', mo.id, 'code', mo.code, 'name', mo.name, 'kind', cm.kind,
                                          'from', v_source.intake_year::text || ' batch') order by mo.code)
      from academics.cohort_modules cm
      join academics.modules mo on mo.id = cm.module_id
      where v_source.id is not null and cm.cohort_id = v_source.id
        and cm.year_of_study = p_year and cm.semester = p_semester
        and not exists (select 1 from academics.cohort_modules mine
                        where mine.cohort_id = v_c.id and mine.year_of_study = p_year
                          and mine.semester = p_semester and mine.module_id = cm.module_id)
        and not exists (select 1 from academics.cohort_module_votes v
                        where v.cohort_id = v_c.id and v.year_of_study = p_year
                          and v.semester = p_semester and v.module_id = cm.module_id)), '[]'::jsonb)
  );
end;
$$;
grant execute on function api.semester_plan(integer, integer) to authenticated;

-- Modules at the caller's university matching a code ("CS20" finds CS2012) or a name, best first,
-- with how many batches list each one. At most 8, at most 60 searches a minute.
create or replace function api.find_modules(p_query text)
returns table (id bigint, code text, name text, batches integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_query text := btrim(coalesce(p_query, ''));
  v_key text := upper(regexp_replace(coalesce(p_query, ''), '[^[:alnum:]]+', '', 'g'));
  v_like text;
  v_institution bigint;
  v_hits integer;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v_institution := (select identity.current_institution_id());

  insert into ops.rate_limits as r (user_id, action, window_start, hits)
  values (v_uid, 'find_modules', date_trunc('minute', now()), 1)
  on conflict on constraint rate_limits_pkey do update set hits = r.hits + 1
  returning r.hits into v_hits;
  if v_hits > 60 then
    raise exception 'Too many searches. Wait a moment.' using errcode = 'PT429';
  end if;

  if char_length(v_query) < 2 then
    return;
  end if;
  v_like := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select m.id, m.code, m.name,
    (select count(distinct cm.cohort_id)::integer from academics.cohort_modules cm where cm.module_id = m.id)
  from academics.modules m
  where m.institution_id = v_institution and m.merged_into_id is null
    and ((v_key <> '' and m.code_key like v_key || '%')
         or m.name ilike v_like
         or extensions.similarity(m.name, v_query) > 0.3)
  order by (m.code_key = v_key) desc, (v_key <> '' and m.code_key like v_key || '%') desc,
    extensions.similarity(m.name, v_query) desc, m.code
  limit 8;
end;
$$;
grant execute on function api.find_modules(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- api: changing
-- ---------------------------------------------------------------------------------------------

-- Saves a semester's list. p_items: up to 25 of {module_id} or {code, name}, each with kind
-- ('core' or 'elective'). A code that is new at the university creates the module; a known code
-- (however it is typed) uses the existing one.
--   Reps and moderators: the list becomes exactly these modules, and batchmates' additions for the
--   semester are settled (included ones join the list, the rest are dropped).
--   Other students: the items not on the list yet are their additions; each joins the list once
--   enough batchmates have added it. They cannot remove what is already on the list.
create or replace function api.save_semester(p_year integer, p_semester integer, p_items jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_c record;
  v_edit boolean;
  v_item jsonb;
  v_kind text;
  v_module bigint;
  v_ids bigint[] := '{}';
  v_kinds text[] := '{}';
  v_pos integer;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v_c from academics.my_cohort();
  if v_c.id is null then
    raise exception 'Join your batch first.' using errcode = '22023';
  end if;
  if p_year is null or p_semester is null or p_year not between 1 and 7 or p_semester not between 1 and v_c.terms_per_year then
    raise exception 'Choose a year and semester.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 25 then
    raise exception 'A semester has up to 25 modules.' using errcode = '22023';
  end if;
  perform messaging.hit_limit('save_semester', 40, 'You have changed your modules a lot today. Try again tomorrow.');
  v_edit := academics.can_edit_cohort(v_c.id);

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_kind := coalesce(v_item ->> 'kind', 'core');
    if v_kind not in ('core', 'elective') then
      raise exception 'A module is core or elective.' using errcode = '22023';
    end if;
    if coalesce(v_item ->> 'module_id', '') ~ '^\d{1,18}$' then
      select coalesce(m.merged_into_id, m.id) into v_module
      from academics.modules m
      where m.id = (v_item ->> 'module_id')::bigint and m.institution_id = v_c.institution_id;
      if v_module is null then
        raise exception 'That module is not at your university.' using errcode = '22023';
      end if;
    else
      v_module := academics.ensure_module(v_c.institution_id, v_item ->> 'code', v_item ->> 'name', v_uid);
    end if;
    -- The same module twice: the last kind wins.
    v_pos := array_position(v_ids, v_module);
    if v_pos is null then
      v_ids := v_ids || v_module;
      v_kinds := v_kinds || v_kind;
    else
      v_kinds[v_pos] := v_kind;
    end if;
  end loop;

  if v_edit then
    delete from academics.cohort_modules cm
    where cm.cohort_id = v_c.id and cm.year_of_study = p_year and cm.semester = p_semester
      and cm.module_id <> all (v_ids);
    insert into academics.cohort_modules (cohort_id, year_of_study, semester, module_id, kind, added_by)
    select v_c.id, p_year, p_semester, x.module_id, x.kind, v_uid
    from unnest(v_ids, v_kinds) as x (module_id, kind)
    on conflict (cohort_id, year_of_study, semester, module_id) do update set kind = excluded.kind;
    delete from academics.cohort_module_votes v
    where v.cohort_id = v_c.id and v.year_of_study = p_year and v.semester = p_semester;
    insert into ops.audit_log (actor_id, action, target_table, target_id, details)
    values (v_uid, 'modules.save_semester', 'academics.cohort_modules', v_c.id::text,
            jsonb_build_object('year', p_year, 'semester', p_semester, 'modules', to_jsonb(v_ids), 'kinds', to_jsonb(v_kinds)));
  else
    delete from academics.cohort_module_votes v
    where v.cohort_id = v_c.id and v.year_of_study = p_year and v.semester = p_semester
      and v.user_id = v_uid and v.module_id <> all (v_ids);
    insert into academics.cohort_module_votes as v (cohort_id, year_of_study, semester, module_id, user_id, kind)
    select v_c.id, p_year, p_semester, x.module_id, v_uid, x.kind
    from unnest(v_ids, v_kinds) as x (module_id, kind)
    where not exists (select 1 from academics.cohort_modules cm
                      where cm.cohort_id = v_c.id and cm.year_of_study = p_year
                        and cm.semester = p_semester and cm.module_id = x.module_id)
    on conflict (cohort_id, year_of_study, semester, module_id, user_id)
    do update set kind = excluded.kind, voted_at = now();
    perform academics.apply_module_votes(v_c.id, p_year, p_semester, x.module_id, v_uid)
    from unnest(v_ids) as x (module_id);
  end if;

  if (p_year, p_semester) = (v_c.current_year, v_c.current_semester) then
    perform academics.sync_course_chats(v_c.id, null);
  end if;
  return api.semester_plan(p_year, p_semester);
end;
$$;
grant execute on function api.save_semester(integer, integer, jsonb) to authenticated;

-- Sets the batch's semester. Reps and moderators set any semester. Other students ask: before the
-- batch has a semester, for any; after, only to move on to the next one. It applies once enough
-- batchmates have asked for the same semester.
create or replace function api.set_batch_term(p_year integer, p_semester integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_c record;
  v_edit boolean;
  v_next_year integer;
  v_next_semester integer;
  v_votes integer;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v_c from academics.my_cohort();
  if v_c.id is null then
    raise exception 'Join your batch first.' using errcode = '22023';
  end if;
  if p_year is null or p_semester is null or p_year not between 1 and 7 or p_semester not between 1 and 3 then
    raise exception 'Choose a year and semester.' using errcode = '22023';
  end if;
  v_edit := academics.can_edit_cohort(v_c.id);

  if p_semester > v_c.terms_per_year then
    if not v_edit then
      raise exception 'Your programme has % semesters a year. Ask a batch rep if that is wrong.', v_c.terms_per_year
        using errcode = '22023';
    end if;
    update academics.programmes pr set terms_per_year = p_semester where pr.id = v_c.programme_id;
  end if;

  if (p_year, p_semester) = (v_c.current_year, v_c.current_semester) then
    delete from academics.cohort_term_votes v where v.cohort_id = v_c.id and v.user_id = v_uid;
    return api.my_modules();
  end if;

  -- Reps too: every change refreshes the whole batch's chat lists.
  perform messaging.hit_limit('term_change', 20, 'You have changed this a lot today. Try again tomorrow.');
  if v_edit then
    perform academics.apply_term(v_c.id, p_year, p_semester, v_uid);
    return api.my_modules();
  end if;

  if v_c.current_year is not null then
    if v_c.current_semester < v_c.terms_per_year then
      v_next_year := v_c.current_year;
      v_next_semester := v_c.current_semester + 1;
    else
      v_next_year := v_c.current_year + 1;
      v_next_semester := 1;
    end if;
    if (p_year, p_semester) <> (v_next_year, v_next_semester) then
      raise exception 'You can ask to move your batch on to Year % · Semester %. For other changes, ask a batch rep.',
        v_next_year, v_next_semester using errcode = '22023';
    end if;
  end if;

  insert into academics.cohort_term_votes as v (cohort_id, user_id, year_of_study, semester)
  values (v_c.id, v_uid, p_year, p_semester)
  on conflict (cohort_id, user_id) do update set year_of_study = excluded.year_of_study,
    semester = excluded.semester, voted_at = now();

  select count(*) into v_votes from academics.cohort_term_votes v
  where v.cohort_id = v_c.id and v.year_of_study = p_year and v.semester = p_semester;
  if v_votes >= academics.votes_needed(v_c.id) then
    perform academics.apply_term(v_c.id, p_year, p_semester, v_uid);
  end if;
  return api.my_modules();
end;
$$;
grant execute on function api.set_batch_term(integer, integer) to authenticated;

-- The student's own choice for a module: 'taking' (an elective), 'not_taking' (a core module they
-- do not take), 'repeat' (a module from an earlier semester they are repeating), or null to go
-- back to the default. Their course chats follow.
create or replace function api.set_module_choice(p_module_id bigint, p_choice text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_c record;
  v_module bigint;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v_c from academics.my_cohort();
  if v_c.id is null then
    raise exception 'Join your batch first.' using errcode = '22023';
  end if;
  if p_choice is not null and p_choice not in ('taking', 'not_taking', 'repeat') then
    raise exception 'Unknown choice.' using errcode = '22023';
  end if;
  select coalesce(m.merged_into_id, m.id) into v_module
  from academics.modules m where m.id = p_module_id and m.institution_id = v_c.institution_id;
  if v_module is null then
    raise exception 'That module is not at your university.' using errcode = '22023';
  end if;
  perform messaging.hit_limit('module_choice', 200, 'You have changed your modules a lot today. Try again tomorrow.');

  if p_choice is null then
    delete from academics.module_choices ch where ch.user_id = v_uid and ch.module_id = v_module;
  else
    insert into academics.module_choices as ch (user_id, module_id, choice)
    values (v_uid, v_module, p_choice)
    on conflict (user_id, module_id) do update set choice = excluded.choice, updated_at = now();
  end if;

  perform academics.sync_course_chats(v_c.id, v_uid);
  return api.my_modules();
end;
$$;
grant execute on function api.set_module_choice(bigint, text) to authenticated;

-- Renames a module (its code never changes). Batch reps whose batch lists it, and the university's
-- moderators. Audited with the old name; course chats take the new name.
create or replace function api.rename_module(p_module_id bigint, p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_c record;
  v_module record;
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select m.id, m.code, m.name, m.institution_id into v_module
  from academics.modules m where m.id = p_module_id and m.merged_into_id is null;
  if v_module.id is null then
    raise exception 'That module is not available.' using errcode = 'P0002';
  end if;
  select * into v_c from academics.my_cohort();
  if not identity.is_staff_for(v_module.institution_id) and not (
    v_c.id is not null and academics.can_edit_cohort(v_c.id)
    and exists (select 1 from academics.cohort_modules cm where cm.cohort_id = v_c.id and cm.module_id = v_module.id)
  ) then
    raise exception 'Only batch reps and moderators can rename a module.' using errcode = '42501';
  end if;
  if char_length(v_name) not between 2 and 120 or v_name ~ '[<>{}\[\]\\]' then
    raise exception 'Module names are 2 to 120 characters.' using errcode = '22023';
  end if;
  if v_name = v_module.name then
    return jsonb_build_object('id', v_module.id, 'code', v_module.code, 'name', v_name);
  end if;
  perform messaging.hit_limit('rename_module', 20, 'You have renamed a lot of modules today. Try again tomorrow.');

  update academics.modules m set name = v_name where m.id = v_module.id;
  update messaging.conversations c set title = left(v_module.code || ' · ' || v_name, 80)
  where c.kind = 'module' and c.module_id = v_module.id;
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_uid, 'modules.rename', 'academics.modules', v_module.id::text,
          jsonb_build_object('from', v_module.name, 'to', v_name));
  return jsonb_build_object('id', v_module.id, 'code', v_module.code, 'name', v_name);
end;
$$;
grant execute on function api.rename_module(bigint, text) to authenticated;

-- Moderators: merges a duplicate (or a code replaced in a curriculum revision) into the module
-- that stays. Lists, additions, choices and course chats move to it; the old code keeps resolving
-- to it. A course chat moves whole when the other module has none for that intake.
create or replace function api.merge_modules(p_from bigint, p_into bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_from record;
  v_into record;
  v_cohort bigint;
begin
  select m.id, m.code, m.name, m.institution_id into v_from
  from academics.modules m where m.id = p_from and m.merged_into_id is null;
  select m.id, m.code, m.name, m.institution_id into v_into
  from academics.modules m where m.id = p_into and m.merged_into_id is null;
  if v_from.id is null or v_into.id is null or v_from.id = v_into.id
     or v_from.institution_id <> v_into.institution_id then
    raise exception 'Choose two different modules at the same university.' using errcode = '22023';
  end if;
  if v_uid is null or not identity.is_staff_for(v_from.institution_id) then
    raise exception 'Only moderators can merge modules.' using errcode = '42501';
  end if;

  update academics.modules m set merged_into_id = v_into.id where m.id = v_from.id or m.merged_into_id = v_from.id;

  insert into academics.cohort_modules (cohort_id, year_of_study, semester, module_id, kind, added_by, added_at)
  select cm.cohort_id, cm.year_of_study, cm.semester, v_into.id, cm.kind, cm.added_by, cm.added_at
  from academics.cohort_modules cm where cm.module_id = v_from.id
  on conflict do nothing;
  delete from academics.cohort_modules cm where cm.module_id = v_from.id;

  insert into academics.cohort_module_votes (cohort_id, year_of_study, semester, module_id, user_id, kind, voted_at)
  select v.cohort_id, v.year_of_study, v.semester, v_into.id, v.user_id, v.kind, v.voted_at
  from academics.cohort_module_votes v where v.module_id = v_from.id
  on conflict do nothing;
  delete from academics.cohort_module_votes v where v.module_id = v_from.id;

  insert into academics.module_choices (user_id, module_id, choice, updated_at)
  select ch.user_id, v_into.id, ch.choice, ch.updated_at
  from academics.module_choices ch where ch.module_id = v_from.id
  on conflict do nothing;
  delete from academics.module_choices ch where ch.module_id = v_from.id;

  update messaging.conversations c set module_id = v_into.id, title = left(v_into.code || ' · ' || v_into.name, 80)
  where c.kind = 'module' and c.module_id = v_from.id
    and not exists (select 1 from messaging.conversations c2
                    where c2.module_id = v_into.id and c2.module_intake = c.module_intake);

  for v_cohort in select distinct cm.cohort_id from academics.cohort_modules cm where cm.module_id = v_into.id loop
    perform academics.sync_course_chats(v_cohort, null);
  end loop;

  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_uid, 'modules.merge', 'academics.modules', v_into.id::text,
          jsonb_build_object('from', jsonb_build_object('id', v_from.id, 'code', v_from.code, 'name', v_from.name)));
end;
$$;
grant execute on function api.merge_modules(bigint, bigint) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Home: "Set up your modules" counts this semester's modules.
-- ---------------------------------------------------------------------------------------------

create or replace function academics.my_module_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when (select identity.is_active_user())
              then coalesce(jsonb_array_length(api.my_modules() -> 'current'), 0) else 0 end;
$$;
revoke execute on function academics.my_module_count() from public, anon;
grant execute on function academics.my_module_count() to authenticated;

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
    'module_count', (select academics.my_module_count()),
    'pending_accounts', (select identity.pending_account_count())
  )
  from identity.profiles p
  join identity.institutions i on i.id = p.institution_id
  where p.user_id = (select auth.uid());
$$;
