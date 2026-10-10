-- "Who can find me" in the account screen: my_account returns the setting, set_findable_by changes
-- it. The privacy trigger from people_search rebuilds the student's search keys in the same
-- transaction, so the change applies to the very next search.

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
      (select s.findable_by from identity.privacy_settings s where s.user_id = p.user_id), 'everyone')
  )
  from identity.profiles p
  join identity.institutions i on i.id = p.institution_id
  where p.user_id = (select auth.uid());
$$;

-- Runs as the caller: RLS limits the update to their own row and the column grant to this setting.
create or replace function api.set_findable_by(p_findable_by text)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_value text;
begin
  if p_findable_by is null or p_findable_by not in ('everyone', 'my_institution', 'nobody') then
    raise exception 'Choose everyone, my_institution or nobody.' using errcode = '22023';
  end if;
  update identity.privacy_settings s set findable_by = p_findable_by
  where s.user_id = (select auth.uid())
  returning s.findable_by into v_value;
  if v_value is null then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return v_value;
end;
$$;
grant execute on function api.set_findable_by(text) to authenticated;
