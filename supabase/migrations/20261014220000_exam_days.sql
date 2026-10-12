-- Exam countdowns count calendar days, not 24-hour blocks: an assignment due at 11:59 pm today is due
-- "today", not "in 1 day". Days are counted in Sri Lanka time (the app also recounts them in the
-- phone's own time zone).

create or replace function api.my_exams()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_c record;
  v_today date := (now() at time zone 'Asia/Colombo')::date;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v_c from academics.my_cohort();
  if v_c.id is null then
    return jsonb_build_object('exams', '[]'::jsonb, 'can_edit', false);
  end if;
  return jsonb_build_object(
    'can_edit', academics.can_set_exams(v_c.id),
    'exams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'kind', e.kind,
        'starts_at', e.starts_at,
        'venue', e.venue,
        'days', greatest(0, (e.starts_at at time zone 'Asia/Colombo')::date - v_today),
        'set_by', (select p.full_name from identity.profiles p where p.user_id = e.set_by),
        'module', jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name)) order by e.starts_at)
      from academics.cohort_exams e
      join academics.modules m on m.id = e.module_id
      where e.cohort_id = v_c.id and e.starts_at > now() - interval '1 day'
        and e.module_id in (select x.module_id from content.my_modules_for(v_uid) x)), '[]'::jsonb));
end;
$$;
grant execute on function api.my_exams() to authenticated;
