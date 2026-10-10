-- Home screen: everything the signed-in home needs in one call (one request per screen).

-- Number of confirmed accounts waiting for approval that the caller may review: their own
-- institutions for moderators, every institution for national admins. Null for everyone else.
-- Security definer because it counts other people's profiles; it returns only a number and only
-- ever answers for the calling user's own staff scope.
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
      and u.email_confirmed_at is not null
      and (v_national or p.institution_id = any (v_institutions))
  );
end;
$$;
revoke execute on function identity.pending_account_count() from public, anon;
grant execute on function identity.pending_account_count() to authenticated;

-- Security invoker: RLS limits every read to the caller's own rows, apart from the staff count,
-- which comes from the narrowly scoped helper above.
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
    'module_count', (select count(*) from academics.module_enrolments e where e.user_id = p.user_id),
    'pending_accounts', (select identity.pending_account_count())
  )
  from identity.profiles p
  join identity.institutions i on i.id = p.institution_id
  where p.user_id = (select auth.uid());
$$;
grant execute on function api.my_home() to authenticated;
