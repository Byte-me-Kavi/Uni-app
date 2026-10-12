-- Degrees are 4 years of 2 semesters. Years 1 to 4 and Semesters 1 and 2 only, enforced by the
-- tables and the api functions (a rep can no longer add a third term, and a batch in Year 4 ·
-- Semester 2 has no next semester).

do $$
declare
  v record;
begin
  for v in
    select c.conrelid::regclass as tbl, c.conname
    from pg_constraint c
    where c.contype = 'c'
      and c.conrelid in ('academics.cohort_modules'::regclass, 'academics.cohort_module_votes'::regclass,
                         'academics.cohort_term_votes'::regclass, 'academics.cohorts'::regclass, 'academics.programmes'::regclass)
      and (pg_get_constraintdef(c.oid) ~ '(year_of_study|semester|current_year|current_semester|terms_per_year)'
           and pg_get_constraintdef(c.oid) ~ 'BETWEEN|>=|<=')
  loop
    execute format('alter table %s drop constraint %I', v.tbl, v.conname);
  end loop;
end $$;

alter table academics.cohort_modules
  add constraint cohort_modules_year_check check (year_of_study between 1 and 4),
  add constraint cohort_modules_semester_check check (semester between 1 and 2);
alter table academics.cohort_module_votes
  add constraint cohort_module_votes_year_check check (year_of_study between 1 and 4),
  add constraint cohort_module_votes_semester_check check (semester between 1 and 2);
alter table academics.cohort_term_votes
  add constraint cohort_term_votes_year_check check (year_of_study between 1 and 4),
  add constraint cohort_term_votes_semester_check check (semester between 1 and 2);
alter table academics.cohorts
  add constraint cohorts_current_year_check check (current_year between 1 and 4),
  add constraint cohorts_current_semester_check check (current_semester between 1 and 2);
update academics.programmes set terms_per_year = 2 where terms_per_year <> 2;
alter table academics.programmes add constraint programmes_terms_per_year_check check (terms_per_year = 2);

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
  if p_year is null or p_semester is null or p_year not between 1 and 4 or p_semester not between 1 and 2 then
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
  if p_year is null or p_semester is null or p_year not between 1 and 4 or p_semester not between 1 and 2 then
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

-- Sets the batch's semester (Year 1 to 4, Semester 1 or 2). Reps and moderators set any semester. Other students ask: before the
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
  if p_year is null or p_semester is null or p_year not between 1 and 4 or p_semester not between 1 and 2 then
    raise exception 'Choose a year and semester.' using errcode = '22023';
  end if;
  v_edit := academics.can_edit_cohort(v_c.id);

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
    if v_c.current_semester < 2 then
      v_next_year := v_c.current_year;
      v_next_semester := v_c.current_semester + 1;
    elsif v_c.current_year < 4 then
      v_next_year := v_c.current_year + 1;
      v_next_semester := 1;
    else
      raise exception 'Your batch is in its final semester (Year 4 · Semester 2).' using errcode = '22023';
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
