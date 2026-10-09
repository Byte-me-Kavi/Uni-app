-- api: the only schema the app and admin dashboard can call. This migration covers app config,
-- the signed-in user's account, and the admin approval queue.

-- Public app configuration: minimum app version and feature switches. Safe for anyone.
create or replace function api.app_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
  from ops.settings s
  where s.key like 'app.%' or s.key like 'feature.%';
$$;
grant execute on function api.app_config() to anon, authenticated;

-- The caller's own account. Security invoker: RLS limits every read to the caller's own rows.
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
    )
  )
  from identity.profiles p
  join identity.institutions i on i.id = p.institution_id
  where p.user_id = (select auth.uid());
$$;
grant execute on function api.my_account() to authenticated;

-- Small partial index: the national approval queue only ever scans pending accounts.
create index profiles_pending_queue_idx on identity.profiles (created_at, user_id)
  where account_status = 'pending';

-- Approval queue for moderators (their institutions) and admins (national, or scoped).
-- Keyset pagination: pass the last row's registered_at and user_id to get the next page.
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
grant execute on function api.pending_accounts(bigint, timestamptz, uuid, integer) to authenticated;

-- Approve, reject, suspend or reinstate an account. One transaction updates the status, records
-- the review and writes the audit log.
create or replace function api.review_account(p_user_id uuid, p_decision text, p_reason text default null)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_reason text := nullif(btrim(p_reason), '');
  v_current text;
  v_institution_id bigint;
  v_new text;
begin
  if v_actor is null then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_user_id = v_actor then
    raise exception 'You cannot review your own account.' using errcode = '42501';
  end if;

  select p.account_status, p.institution_id into v_current, v_institution_id
  from identity.profiles p
  where p.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Account not found.' using errcode = 'P0002';
  end if;

  if not identity.is_staff_for(v_institution_id) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  -- Only a national admin may act on another staff member's account.
  if exists (select 1 from identity.staff_roles s where s.user_id = p_user_id)
     and not exists (
       select 1 from identity.staff_roles s
       where s.user_id = v_actor and s.role = 'admin' and s.institution_id is null
     ) then
    raise exception 'Only a national admin can review a staff account.' using errcode = '42501';
  end if;

  v_new := case
    when p_decision = 'approved' and v_current in ('pending', 'rejected') then 'active'
    when p_decision = 'rejected' and v_current = 'pending' then 'rejected'
    when p_decision = 'suspended' and v_current = 'active' then 'suspended'
    when p_decision = 'reinstated' and v_current = 'suspended' then 'active'
  end;

  if v_new is null then
    raise exception 'Cannot apply "%" to an account that is %.', p_decision, v_current using errcode = '22023';
  end if;

  if p_decision in ('rejected', 'suspended') and (v_reason is null or char_length(v_reason) < 3) then
    raise exception 'A reason is required.' using errcode = '22023';
  end if;

  if p_decision = 'approved'
     and not exists (select 1 from auth.users u where u.id = p_user_id and u.email_confirmed_at is not null) then
    raise exception 'This student has not confirmed their email yet.' using errcode = '22023';
  end if;

  update identity.profiles set account_status = v_new where user_id = p_user_id;

  insert into identity.account_reviews (user_id, decision, reason, reviewed_by)
  values (p_user_id, p_decision, v_reason, v_actor);

  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_actor, 'account.' || p_decision, 'identity.profiles', p_user_id::text,
          jsonb_build_object('from', v_current, 'to', v_new, 'reason', v_reason));

  return v_new;
end;
$$;
grant execute on function api.review_account(uuid, text, text) to authenticated;
