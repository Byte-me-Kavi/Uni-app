-- Chat tools: reporting from chats, batch reps and group admins (slow mode, announcement-only,
-- pinning), quiet hours for notifications, groups students create themselves, and pinning or
-- archiving chats in the list.
--
-- Roles in a chat (messaging.conversation_members.role):
--   batch and programme groups: 'admin' is a batch rep. Reps are appointed by Uni Era staff
--     (moderators of that university for a batch; national admins for a programme group), never
--     by the students themselves, and every change is written to the audit log.
--   groups students create: 'admin' is a group admin. The creator starts as admin and can make
--     others admins, as in WhatsApp.

-- ---------------------------------------------------------------------------------------------
-- Columns and tables
-- ---------------------------------------------------------------------------------------------

alter table messaging.conversation_members
  add column list_pinned_at timestamptz,
  add column archived_at timestamptz;

-- Quiet hours: no notifications between start and end (minutes after midnight, in the student's
-- time zone). Messages still arrive; the phone stays silent.
create table messaging.notification_settings (
  user_id uuid primary key references identity.profiles (user_id) on delete cascade,
  quiet_enabled boolean not null default false,
  quiet_start smallint not null default 1380 check (quiet_start between 0 and 1439),
  quiet_end smallint not null default 420 check (quiet_end between 0 and 1439),
  time_zone text not null default 'Asia/Colombo',
  updated_at timestamptz not null default now()
);
alter table messaging.notification_settings enable row level security;
-- Read and written only through api functions.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- True while the student is inside their quiet hours (a window may cross midnight).
create or replace function messaging.in_quiet_hours(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when s.quiet_start = s.quiet_end then false
      when s.quiet_start < s.quiet_end then t.minute >= s.quiet_start and t.minute < s.quiet_end
      else t.minute >= s.quiet_start or t.minute < s.quiet_end
    end
    from messaging.notification_settings s,
      lateral (select (extract(hour from now() at time zone s.time_zone) * 60
                       + extract(minute from now() at time zone s.time_zone))::integer as minute) t
    where s.user_id = p_user_id and s.quiet_enabled
  ), false);
$$;
revoke execute on function messaging.in_quiet_hours(uuid) from public, anon, authenticated;

-- National admins (staff with no university scope): they appoint reps for national groups.
create or replace function identity.is_national_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from identity.staff_roles s
    join identity.profiles p on p.user_id = s.user_id and p.account_status = 'active'
    where s.user_id = (select auth.uid()) and s.role = 'admin' and s.institution_id is null
  );
$$;
grant execute on function identity.is_national_admin() to authenticated, service_role;

-- The university a batch chat belongs to (null for other chats).
create or replace function messaging.chat_institution(p_conversation_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select pr.institution_id
  from messaging.conversations c
  join academics.cohorts co on co.id = c.cohort_id
  join academics.programmes pr on pr.id = co.programme_id
  where c.id = p_conversation_id;
$$;
revoke execute on function messaging.chat_institution(uuid) from public, anon, authenticated;

-- May the caller appoint or remove reps or admins in this chat?
create or replace function messaging.can_appoint(p_conversation_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  select c.kind into v_kind from messaging.conversations c where c.id = p_conversation_id;
  if v_kind = 'cohort' then
    return identity.is_staff_for(messaging.chat_institution(p_conversation_id));
  elsif v_kind = 'programme' then
    return identity.is_national_admin();
  elsif v_kind = 'group' then
    return exists (
      select 1 from messaging.conversation_members m
      where m.conversation_id = p_conversation_id and m.user_id = (select auth.uid()) and m.role = 'admin'
    ) and (select identity.is_active_user());
  end if;
  return false;
end;
$$;
revoke execute on function messaging.can_appoint(uuid) from public, anon, authenticated;

-- May p_adder put p_target in a group? Same rules as starting a direct chat (blocks both ways,
-- the target's "who can message me"), and students at another university only after the two
-- have an accepted direct chat: a group is never a way round message requests.
create or replace function messaging.can_add(p_adder uuid, p_target uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_them record;
  v_setting text;
begin
  if p_target is null or p_target = p_adder then
    return false;
  end if;
  select p.institution_id, m.cohort_id into v_me
  from identity.profiles p left join academics.cohort_members m on m.user_id = p.user_id
  where p.user_id = p_adder;
  select p.institution_id, p.account_status, m.cohort_id into v_them
  from identity.profiles p left join academics.cohort_members m on m.user_id = p.user_id
  where p.user_id = p_target;
  if v_them.account_status is distinct from 'active'
     or exists (select 1 from safety.blocks b
                where (b.blocker_id = p_adder and b.blocked_id = p_target) or (b.blocker_id = p_target and b.blocked_id = p_adder)) then
    return false;
  end if;
  select coalesce(s.who_can_message, 'my_institution') into v_setting from identity.privacy_settings s where s.user_id = p_target;
  v_setting := coalesce(v_setting, 'my_institution');
  if v_setting = 'nobody'
     or (v_setting = 'my_cohort' and (v_me.cohort_id is null or v_me.cohort_id is distinct from v_them.cohort_id))
     or (v_setting = 'my_institution' and v_me.institution_id is distinct from v_them.institution_id) then
    return false;
  end if;
  if v_me.institution_id is distinct from v_them.institution_id then
    return exists (
      select 1 from messaging.direct_conversations d
      where d.user_low = least(p_adder, p_target) and d.user_high = greatest(p_adder, p_target)
        and d.request_status = 'accepted'
    );
  end if;
  return true;
end;
$$;
revoke execute on function messaging.can_add(uuid, uuid) from public, anon, authenticated;

-- Tells students their chat list changed (added to a group, removed): their apps refresh it.
create or replace function messaging.tell_users(p_user_ids uuid[], p_event text, p_payload jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  foreach v_user in array coalesce(p_user_ids, '{}') loop
    perform realtime.send(p_payload, p_event, 'user:' || v_user, true);
  end loop;
end;
$$;
revoke execute on function messaging.tell_users(uuid[], text, jsonb) from public, anon, authenticated;

-- Counts an action against a per-day limit; raises PT429 past it.
create or replace function messaging.hit_limit(p_action text, p_per_day integer, p_message text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hits integer;
begin
  insert into ops.rate_limits as r (user_id, action, window_start, hits)
  values ((select auth.uid()), p_action, date_trunc('day', now()), 1)
  on conflict on constraint rate_limits_pkey do update set hits = r.hits + 1
  returning r.hits into v_hits;
  if v_hits > p_per_day then
    raise exception '%', p_message using errcode = 'PT429';
  end if;
end;
$$;
revoke execute on function messaging.hit_limit(text, integer, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Reporting
-- ---------------------------------------------------------------------------------------------

-- Reports a message, a student or a group to the moderators. A copy of what was reported (and,
-- for a message, the messages around it) is kept with the report, so deleting it afterwards does
-- not remove the evidence. The person reported is never told who reported them.
create or replace function api.report(
  p_kind text,
  p_target_id text,
  p_category text,
  p_details text default null,
  p_conversation_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint;
  v_snapshot jsonb;
  v_message messaging.messages;
  v_target uuid;
  v_existing uuid;
  v_id uuid;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_kind not in ('message', 'profile', 'conversation') then
    raise exception 'Unknown report.' using errcode = '22023';
  end if;
  if not exists (select 1 from safety.report_categories rc where rc.code = p_category) then
    raise exception 'Choose what is wrong.' using errcode = '22023';
  end if;
  if p_details is not null and char_length(p_details) > 1000 then
    raise exception 'Keep the details under 1,000 characters.' using errcode = '22023';
  end if;

  -- The same report twice is one report.
  select r.id into v_existing from safety.reports r
  where r.reporter_id = v_uid and r.target_kind = p_kind and r.target_id = p_target_id and r.status = 'open';
  if v_existing is not null then
    return v_existing;
  end if;
  perform messaging.hit_limit('report', 20, 'You have sent a lot of reports today. Our team will look at them first.');

  if p_kind = 'message' then
    v_message := messaging.visible_message(p_conversation_id, p_target_id::uuid);
    if v_message.id is null then
      raise exception 'That message is not available.' using errcode = 'P0002';
    end if;
    if v_message.sender_id = v_uid then
      raise exception 'You cannot report your own message.' using errcode = '22023';
    end if;
    select p.institution_id into v_institution from identity.profiles p where p.user_id = v_message.sender_id;
    v_snapshot := jsonb_build_object(
      'message', jsonb_build_object('id', v_message.id, 'sender_id', v_message.sender_id, 'body', v_message.body,
        'kind', v_message.kind, 'attachment', v_message.attachment, 'created_at', v_message.created_at),
      'sender', (select jsonb_build_object('user_id', p.user_id, 'full_name', p.full_name) from identity.profiles p where p.user_id = v_message.sender_id),
      'conversation', (select jsonb_build_object('id', c.id, 'kind', c.kind, 'title', c.title) from messaging.conversations c where c.id = p_conversation_id),
      -- Five messages either side, for context.
      'context', coalesce((
        select jsonb_agg(x order by x->>'created_at')
        from (
          (select jsonb_build_object('id', m.id, 'sender_id', m.sender_id, 'body', m.body, 'kind', m.kind, 'created_at', m.created_at) x
           from messaging.messages m
           where m.conversation_id = p_conversation_id and m.created_at < v_message.created_at and m.deleted_at is null
           order by m.created_at desc limit 5)
          union all
          (select jsonb_build_object('id', m.id, 'sender_id', m.sender_id, 'body', m.body, 'kind', m.kind, 'created_at', m.created_at)
           from messaging.messages m
           where m.conversation_id = p_conversation_id and m.created_at > v_message.created_at and m.deleted_at is null
           order by m.created_at limit 5)
        ) around), '[]'::jsonb)
    );
  elsif p_kind = 'profile' then
    v_target := p_target_id::uuid;
    if v_target = v_uid then
      raise exception 'You cannot report yourself.' using errcode = '22023';
    end if;
    select p.institution_id,
      jsonb_build_object('user_id', p.user_id, 'full_name', p.full_name, 'avatar_path', p.avatar_path, 'institution_id', p.institution_id)
    into v_institution, v_snapshot
    from identity.profiles p where p.user_id = v_target;
    if v_snapshot is null then
      raise exception 'That student is not available.' using errcode = 'P0002';
    end if;
  else
    if not messaging.is_member(p_target_id::uuid) then
      raise exception 'You are not in this chat.' using errcode = '42501';
    end if;
    v_institution := messaging.chat_institution(p_target_id::uuid);
    v_snapshot := jsonb_build_object(
      'conversation', (select jsonb_build_object('id', c.id, 'kind', c.kind, 'title', c.title, 'member_count', c.member_count)
                       from messaging.conversations c where c.id = p_target_id::uuid),
      'recent', coalesce((
        select jsonb_agg(x order by x->>'created_at') from (
          select jsonb_build_object('id', m.id, 'sender_id', m.sender_id, 'body', m.body, 'kind', m.kind, 'created_at', m.created_at) x
          from messaging.messages m
          where m.conversation_id = p_target_id::uuid and m.deleted_at is null
          order by m.created_at desc limit 20) recent), '[]'::jsonb)
    );
  end if;

  insert into safety.reports (reporter_id, institution_id, target_kind, target_id, category_code, details, snapshot)
  values (v_uid, coalesce(v_institution, (select identity.current_institution_id())), p_kind, p_target_id, p_category,
          nullif(btrim(coalesce(p_details, '')), ''), v_snapshot)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function api.report(text, text, text, text, uuid) to authenticated;

-- The categories offered in the report sheet, most urgent first.
create or replace function api.report_categories()
returns table (code text, label text)
language sql
stable
security definer
set search_path = ''
as $$
  select rc.code, rc.label from safety.report_categories rc order by rc.priority, rc.label;
$$;
grant execute on function api.report_categories() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Chat settings, reps and admins
-- ---------------------------------------------------------------------------------------------

-- What the group details screen needs to show its settings and who may change what.
create or replace function api.chat_settings(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row record;
begin
  select c.kind, c.title, c.slow_mode_seconds, c.announcement_only, c.member_count, c.created_by, m.role into v_row
  from messaging.conversations c
  join messaging.conversation_members m on m.conversation_id = c.id and m.user_id = v_uid
  where c.id = p_conversation_id;
  if v_row.kind is null or not (select identity.is_active_user()) then
    raise exception 'You are not in this chat.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'kind', v_row.kind,
    'title', v_row.title,
    'slow_mode_seconds', v_row.slow_mode_seconds,
    'announcement_only', v_row.announcement_only,
    'member_count', v_row.member_count,
    'my_role', v_row.role,
    'can_manage', v_row.role = 'admin' and v_row.kind in ('cohort', 'programme', 'group'),
    'can_appoint', messaging.can_appoint(p_conversation_id)
  );
end;
$$;
grant execute on function api.chat_settings(uuid) to authenticated;

-- Reps (batch and programme groups) and admins (own groups) change slow mode, who may send, and
-- (own groups only) the name. Enforced here and in send_message, not just hidden in the app.
create or replace function api.update_chat_settings(
  p_conversation_id uuid,
  p_slow_mode_seconds integer default null,
  p_announcement_only boolean default null,
  p_title text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text;
  v_role text;
  v_after messaging.conversations;
begin
  select c.kind, m.role into v_kind, v_role
  from messaging.conversations c
  join messaging.conversation_members m on m.conversation_id = c.id and m.user_id = v_uid
  where c.id = p_conversation_id;
  if v_role is distinct from 'admin' or v_kind not in ('cohort', 'programme', 'group') or not (select identity.is_active_user()) then
    raise exception 'Only reps and group admins can change this.' using errcode = '42501';
  end if;
  if p_slow_mode_seconds is not null and p_slow_mode_seconds not in (0, 10, 30, 60, 300, 900, 3600) then
    raise exception 'Choose one of the slow mode options.' using errcode = '22023';
  end if;
  if p_title is not null and (v_kind <> 'group' or char_length(btrim(p_title)) not between 1 and 80) then
    raise exception 'Group names are 1 to 80 characters, and only your own groups can be renamed.' using errcode = '22023';
  end if;

  update messaging.conversations c set
    slow_mode_seconds = coalesce(p_slow_mode_seconds, c.slow_mode_seconds),
    announcement_only = coalesce(p_announcement_only, c.announcement_only),
    title = coalesce(nullif(btrim(p_title), ''), c.title)
  where c.id = p_conversation_id
  returning * into v_after;

  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_uid, 'chat.update_settings', 'messaging.conversations', p_conversation_id::text,
          jsonb_build_object('slow_mode_seconds', p_slow_mode_seconds, 'announcement_only', p_announcement_only, 'title', p_title));

  perform messaging.broadcast(p_conversation_id, 'settings', jsonb_build_object(
    'conversation_id', p_conversation_id, 'slow_mode_seconds', v_after.slow_mode_seconds,
    'announcement_only', v_after.announcement_only, 'title', v_after.title));
  return jsonb_build_object('slow_mode_seconds', v_after.slow_mode_seconds, 'announcement_only', v_after.announcement_only, 'title', v_after.title);
end;
$$;
grant execute on function api.update_chat_settings(uuid, integer, boolean, text) to authenticated;

-- Makes a member a rep or admin ('admin'), or an ordinary member again ('member'). Batch reps
-- are appointed by the university's moderators, programme reps by national admins, own-group
-- admins by that group's admins. Audited. A group always keeps at least one admin.
create or replace function api.set_member_role(p_conversation_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text;
begin
  if p_role not in ('admin', 'member') then
    raise exception 'Unknown role.' using errcode = '22023';
  end if;
  if not messaging.can_appoint(p_conversation_id) then
    raise exception 'You cannot change roles in this chat.' using errcode = '42501';
  end if;
  select c.kind into v_kind from messaging.conversations c where c.id = p_conversation_id;
  if v_kind = 'group' and p_role = 'member' and not exists (
    select 1 from messaging.conversation_members m
    where m.conversation_id = p_conversation_id and m.role = 'admin' and m.user_id <> p_user_id
  ) then
    raise exception 'A group needs at least one admin.' using errcode = '22023';
  end if;
  if v_kind in ('cohort', 'programme') and p_role = 'admin' and (
    select count(*) from messaging.conversation_members m where m.conversation_id = p_conversation_id and m.role = 'admin'
  ) >= 5 then
    raise exception 'A group has at most 5 reps. Remove one first.' using errcode = '22023';
  end if;

  update messaging.conversation_members m set role = p_role
  where m.conversation_id = p_conversation_id and m.user_id = p_user_id;
  if not found then
    raise exception 'That student is not in this chat.' using errcode = 'P0002';
  end if;

  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_uid, 'chat.set_role', 'messaging.conversation_members', p_conversation_id::text,
          jsonb_build_object('user_id', p_user_id, 'role', p_role, 'kind', v_kind));
  perform messaging.tell_users(array[p_user_id], 'chats', jsonb_build_object('conversation_id', p_conversation_id));
end;
$$;
grant execute on function api.set_member_role(uuid, uuid, text) to authenticated;

-- Pinning in groups is for reps and admins; in direct chats either student can pin.
create or replace function api.pin_message(p_conversation_id uuid, p_message_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_kind text;
  v_message messaging.messages;
  v_pinned jsonb;
begin
  select m.role, c.kind into v_role, v_kind
  from messaging.conversation_members m join messaging.conversations c on c.id = m.conversation_id
  where m.conversation_id = p_conversation_id and m.user_id = v_uid;
  if v_uid is null or v_role is null or not (select identity.is_active_user()) then
    raise exception 'You are not in this chat.' using errcode = '42501';
  end if;
  if v_kind <> 'direct' and v_role <> 'admin' then
    raise exception 'Only reps and group admins can pin messages in groups.' using errcode = '42501';
  end if;

  if p_message_id is not null then
    v_message := messaging.visible_message(p_conversation_id, p_message_id);
    if v_message.id is null then
      raise exception 'That message is not available.' using errcode = '22023';
    end if;
    v_pinned := messaging.reply_snapshot(v_message);
  end if;

  update messaging.conversations c set pinned_message_id = p_message_id,
    pinned_at = case when p_message_id is null then null else now() end,
    pinned_by = case when p_message_id is null then null else v_uid end
  where c.id = p_conversation_id;

  perform messaging.broadcast(p_conversation_id, 'pin', jsonb_build_object('conversation_id', p_conversation_id, 'pinned', v_pinned));
  return v_pinned;
end;
$$;
grant execute on function api.pin_message(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Groups students create
-- ---------------------------------------------------------------------------------------------

-- Adds the students the caller may add (see can_add) to a group, up to 100 members in all.
-- Returns who was added and who could not be.
create or replace function messaging.add_to_group(p_conversation_id uuid, p_user_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_user uuid;
  v_added uuid[] := '{}';
  v_skipped jsonb := '[]'::jsonb;
  v_room integer;
begin
  select 100 - c.member_count into v_room from messaging.conversations c where c.id = p_conversation_id;
  foreach v_user in array coalesce((select array_agg(distinct u) from unnest(coalesce(p_user_ids, '{}'::uuid[])) u), '{}'::uuid[]) loop
    continue when v_user is null or v_user = v_uid;
    continue when exists (select 1 from messaging.conversation_members m where m.conversation_id = p_conversation_id and m.user_id = v_user);
    if v_room <= 0 or not messaging.can_add(v_uid, v_user) then
      v_skipped := v_skipped || jsonb_build_object('user_id', v_user,
        'full_name', (select p.full_name from identity.profiles p where p.user_id = v_user),
        'reason', case when v_room <= 0 then 'full' else 'not_allowed' end);
      continue;
    end if;
    insert into messaging.conversation_members (conversation_id, user_id) values (p_conversation_id, v_user);
    v_added := v_added || v_user;
    v_room := v_room - 1;
  end loop;
  perform messaging.tell_users(v_added, 'chats', jsonb_build_object('conversation_id', p_conversation_id));
  return jsonb_build_object('added', to_jsonb(v_added), 'skipped', v_skipped);
end;
$$;
revoke execute on function messaging.add_to_group(uuid, uuid[]) from public, anon, authenticated;

-- A new group (project group, lab group, study circle). The creator is its first admin.
create or replace function api.create_group(p_title text, p_member_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_result jsonb;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 80 then
    raise exception 'Give the group a name (up to 80 characters).' using errcode = '22023';
  end if;
  if coalesce(array_length(p_member_ids, 1), 0) = 0 then
    raise exception 'Add at least one student.' using errcode = '22023';
  end if;
  if array_length(p_member_ids, 1) > 99 then
    raise exception 'A group can have up to 100 members.' using errcode = '22023';
  end if;
  perform messaging.hit_limit('create_group', 10, 'You have made a lot of groups today. Try again tomorrow.');

  insert into messaging.conversations (kind, title, created_by) values ('group', btrim(p_title), v_uid) returning id into v_id;
  insert into messaging.conversation_members (conversation_id, user_id, role) values (v_id, v_uid, 'admin');
  v_result := messaging.add_to_group(v_id, p_member_ids);
  return v_result || jsonb_build_object('conversation_id', v_id);
end;
$$;
grant execute on function api.create_group(text, uuid[]) to authenticated;

create or replace function api.add_group_members(p_conversation_id uuid, p_member_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from messaging.conversations c
    join messaging.conversation_members m on m.conversation_id = c.id and m.user_id = (select auth.uid()) and m.role = 'admin'
    where c.id = p_conversation_id and c.kind = 'group'
  ) or not (select identity.is_active_user()) then
    raise exception 'Only group admins can add people.' using errcode = '42501';
  end if;
  return messaging.add_to_group(p_conversation_id, p_member_ids);
end;
$$;
grant execute on function api.add_group_members(uuid, uuid[]) to authenticated;

create or replace function api.remove_group_member(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if p_user_id = v_uid then
    raise exception 'Use Leave group to leave.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from messaging.conversations c
    join messaging.conversation_members m on m.conversation_id = c.id and m.user_id = v_uid and m.role = 'admin'
    where c.id = p_conversation_id and c.kind = 'group'
  ) or not (select identity.is_active_user()) then
    raise exception 'Only group admins can remove people.' using errcode = '42501';
  end if;
  delete from messaging.conversation_members m where m.conversation_id = p_conversation_id and m.user_id = p_user_id;
  if not found then
    raise exception 'That student is not in this group.' using errcode = 'P0002';
  end if;
  perform messaging.tell_users(array[p_user_id], 'chats', jsonb_build_object('conversation_id', p_conversation_id));
end;
$$;
grant execute on function api.remove_group_member(uuid, uuid) to authenticated;

-- Leaves a group you created or were added to. If the last admin leaves, the longest-standing
-- member becomes admin; when nobody is left the group is deleted.
create or replace function api.leave_group(p_conversation_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not exists (select 1 from messaging.conversations c where c.id = p_conversation_id and c.kind = 'group') then
    raise exception 'Only groups you made or were added to can be left.' using errcode = '22023';
  end if;
  delete from messaging.conversation_members m where m.conversation_id = p_conversation_id and m.user_id = v_uid;
  if not found then
    raise exception 'You are not in this group.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from messaging.conversation_members m where m.conversation_id = p_conversation_id) then
    delete from messaging.conversations c where c.id = p_conversation_id;
    return;
  end if;
  if not exists (select 1 from messaging.conversation_members m where m.conversation_id = p_conversation_id and m.role = 'admin') then
    update messaging.conversation_members m set role = 'admin'
    where (m.conversation_id, m.user_id) = (
      select m2.conversation_id, m2.user_id from messaging.conversation_members m2
      where m2.conversation_id = p_conversation_id order by m2.joined_at limit 1);
  end if;
end;
$$;
grant execute on function api.leave_group(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The chat list: pin and archive
-- ---------------------------------------------------------------------------------------------

-- Pins a chat to the top of your list (up to 3, as in WhatsApp) or archives it out of the list.
-- Only you see either.
create or replace function api.set_chat_state(p_conversation_id uuid, p_pinned boolean default null, p_archived boolean default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not messaging.is_member(p_conversation_id) then
    raise exception 'You are not in this chat.' using errcode = '42501';
  end if;
  if p_pinned and (
    select count(*) from messaging.conversation_members m
    where m.user_id = v_uid and m.list_pinned_at is not null and m.conversation_id <> p_conversation_id
  ) >= 3 then
    raise exception 'You can pin up to 3 chats.' using errcode = '22023';
  end if;
  update messaging.conversation_members m set
    list_pinned_at = case when p_pinned is null then m.list_pinned_at when p_pinned then coalesce(m.list_pinned_at, now()) else null end,
    archived_at = case when p_archived is null then m.archived_at when p_archived then coalesce(m.archived_at, now()) else null end
  where m.conversation_id = p_conversation_id and m.user_id = v_uid;
  -- An archived chat is not pinned.
  if p_archived then
    update messaging.conversation_members m set list_pinned_at = null where m.conversation_id = p_conversation_id and m.user_id = v_uid;
  end if;
end;
$$;
grant execute on function api.set_chat_state(uuid, boolean, boolean) to authenticated;

-- The chat list, now with list pins, archive state, and each group's sending rules.
drop function api.my_chats();
create function api.my_chats()
returns table (
  conversation_id uuid,
  kind text,
  title text,
  other_user_id uuid,
  other_avatar_path text,
  last_message_at timestamptz,
  last_message_preview text,
  last_sender_id uuid,
  last_sender_name text,
  unread integer,
  muted boolean,
  request text,
  member_count integer,
  my_last_read_at timestamptz,
  other_last_read_at timestamptz,
  created_at timestamptz,
  other_delivered_at timestamptz,
  pinned jsonb,
  my_role text,
  list_pinned_at timestamptz,
  archived boolean,
  announcement_only boolean,
  slow_mode_seconds integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  return query
  select c.id, c.kind,
    case when c.kind = 'direct' then op.full_name else c.title end,
    op.user_id, op.avatar_path,
    c.last_message_at, c.last_message_preview, c.last_sender_id, ls.full_name,
    (select count(*)::integer from (
       select 1 from messaging.messages m
       where m.conversation_id = c.id and m.created_at > coalesce(me.last_read_at, me.joined_at)
         and m.sender_id is distinct from v_uid and m.deleted_at is null
       limit 100) u),
    coalesce(me.muted_until > now(), false),
    case
      when d.conversation_id is null or d.request_status = 'accepted' then null
      when d.initiated_by = v_uid then 'outgoing'
      else 'incoming'
    end,
    c.member_count, me.last_read_at, om.last_read_at, c.created_at,
    greatest(om.delivered_at, om.last_read_at),
    (select messaging.reply_snapshot(pm) from messaging.messages pm
     where c.pinned_message_id is not null and pm.id = c.pinned_message_id and pm.conversation_id = c.id
       and pm.deleted_at is null limit 1),
    me.role,
    me.list_pinned_at,
    me.archived_at is not null,
    c.announcement_only,
    c.slow_mode_seconds::integer
  from messaging.conversation_members me
  join messaging.conversations c on c.id = me.conversation_id
  left join messaging.direct_conversations d on d.conversation_id = c.id
  left join identity.profiles op on c.kind = 'direct'
    and op.user_id = case when d.user_low = v_uid then d.user_high else d.user_low end
  left join messaging.conversation_members om on om.conversation_id = c.id and om.user_id = op.user_id
  left join identity.profiles ls on ls.user_id = c.last_sender_id
  where me.user_id = v_uid
    and (c.kind not in ('direct') or c.last_message_id is not null)
    and not coalesce(d.request_status = 'ignored' and d.initiated_by <> v_uid, false)
    and not exists (select 1 from safety.blocks b where b.blocker_id = v_uid and b.blocked_id = op.user_id)
  order by me.list_pinned_at desc nulls last, coalesce(c.last_message_at, c.created_at) desc;
end;
$$;
grant execute on function api.my_chats() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Quiet hours
-- ---------------------------------------------------------------------------------------------

create or replace function api.notification_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'quiet_enabled', coalesce(s.quiet_enabled, false),
    'quiet_start', coalesce(s.quiet_start, 1380),
    'quiet_end', coalesce(s.quiet_end, 420)
  )
  from (select 1) one
  left join messaging.notification_settings s on s.user_id = (select auth.uid());
$$;
grant execute on function api.notification_settings() to authenticated;

create or replace function api.set_quiet_hours(p_enabled boolean, p_start integer default null, p_end integer default null)
returns jsonb
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
  if (p_start is not null and p_start not between 0 and 1439) or (p_end is not null and p_end not between 0 and 1439) then
    raise exception 'Choose a time of day.' using errcode = '22023';
  end if;
  insert into messaging.notification_settings as s (user_id, quiet_enabled, quiet_start, quiet_end)
  values (v_uid, p_enabled, coalesce(p_start, 1380), coalesce(p_end, 420))
  on conflict (user_id) do update set
    quiet_enabled = excluded.quiet_enabled,
    quiet_start = coalesce(p_start, s.quiet_start),
    quiet_end = coalesce(p_end, s.quiet_end),
    updated_at = now();
  return api.notification_settings();
end;
$$;
grant execute on function api.set_quiet_hours(boolean, integer, integer) to authenticated;

-- Push recipients now skip students in their quiet hours (mentions included: quiet means quiet).
create or replace function messaging.push_recipients(p_conversation_id uuid, p_sender_id uuid, p_mentions uuid[])
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id
  from messaging.conversation_members m
  join messaging.conversations c on c.id = m.conversation_id
  left join messaging.direct_conversations d on d.conversation_id = c.id
  where m.conversation_id = p_conversation_id
    and m.user_id <> p_sender_id
    and exists (select 1 from messaging.push_tokens t where t.user_id = m.user_id)
    and not exists (select 1 from safety.blocks b where b.blocker_id = m.user_id and b.blocked_id = p_sender_id)
    and not messaging.in_quiet_hours(m.user_id)
    and (
      m.user_id = any (coalesce(p_mentions, '{}'))
      or (
        (m.muted_until is null or m.muted_until <= now())
        and case
          when c.kind = 'direct' then d.request_status <> 'ignored'
          else m.notified_at is null
            or m.notified_at <= coalesce(m.last_read_at, '-infinity'::timestamptz)
            or m.notified_at < now() - interval '15 minutes'
        end
      )
    );
$$;
revoke execute on function messaging.push_recipients(uuid, uuid, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Sending: reps and group admins are not held by slow mode (as in Telegram and WhatsApp), so a
-- rep can post several announcements in a row. Otherwise unchanged from messaging_v2.
-- ---------------------------------------------------------------------------------------------

create or replace function api.send_message(
  p_conversation_id uuid,
  p_id uuid,
  p_body text default '',
  p_reply_to_id uuid default null,
  p_kind text default 'text',
  p_attachment jsonb default null,
  p_forward_from uuid default null,
  p_mentions uuid[] default null,
  p_link jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := coalesce(p_kind, 'text');
  v_body text := btrim(coalesce(p_body, ''));
  v_attachment jsonb;
  v_upload record;
  v_upload_path text; -- set for photos, documents and voice notes
  v_media_path text;
  v_source messaging.messages;
  v_reply jsonb;
  v_link jsonb;
  v_mentions uuid[];
  v_forwarded boolean := false;
  v_conversation record;
  v_direct record;
  v_other uuid;
  v_hits integer;
  v_created timestamptz;
  v_sender record;
  v_payload jsonb;
  v_contact record;
  v_options jsonb;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_id is null or substr(p_id::text, 15, 1) <> '7' then
    raise exception 'Messages need a version 7 id.' using errcode = '22023';
  end if;

  -- A retry of a message that was already saved.
  select m.created_at into v_created from messaging.messages m
  where m.id = p_id and m.conversation_id = p_conversation_id and m.sender_id = v_uid
    and m.created_at > now() - interval '2 days';
  if v_created is not null then
    return jsonb_build_object('id', p_id, 'created_at', v_created, 'duplicate', true);
  end if;

  if p_forward_from is not null then
    -- Forwarding: the original, from any chat the sender is in, copied as it is.
    select m.* into v_source from messaging.messages m
    join messaging.conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = v_uid
    where m.id = p_forward_from and m.deleted_at is null
    limit 1;
    if v_source.id is null then
      raise exception 'That message cannot be forwarded.' using errcode = '22023';
    end if;
    v_kind := v_source.kind;
    v_body := v_source.body;
    v_attachment := v_source.attachment;
    v_link := v_source.link;
    v_forwarded := true;
    v_media_path := case when v_kind in ('image', 'file', 'voice') then v_attachment ->> 'path' end;
  elsif v_kind = 'text' then
    if char_length(v_body) not between 1 and 4000 then
      raise exception 'Messages are 1 to 4000 characters.' using errcode = '22023';
    end if;
    -- A link preview made on the sender's phone; only well-formed fields are kept.
    if p_link is not null and coalesce(p_link ->> 'url', '') ~ '^https?://' and char_length(p_link ->> 'url') <= 2000 then
      v_link := jsonb_strip_nulls(jsonb_build_object(
        'url', p_link ->> 'url',
        'title', left(p_link ->> 'title', 200),
        'description', left(p_link ->> 'description', 300),
        'site', left(p_link ->> 'site', 100),
        'image', case when coalesce(p_link ->> 'image', '') ~ '^https://' and char_length(p_link ->> 'image') <= 1000
                      then p_link ->> 'image' end));
    end if;
  elsif v_kind in ('image', 'file', 'voice') then
    if char_length(v_body) > 1024 then
      raise exception 'Captions are up to 1024 characters.' using errcode = '22023';
    end if;
    select * into v_upload from messaging.uploads u
    where u.path = p_attachment ->> 'path' and u.user_id = v_uid and u.conversation_id = p_conversation_id
      and u.kind = v_kind and u.message_id is null;
    if v_upload.path is null then
      raise exception 'That file was not uploaded to this chat.' using errcode = '22023';
    end if;
    v_upload_path := v_upload.path;
    v_media_path := v_upload.path;
    if v_kind = 'image' then
      if coalesce((p_attachment ->> 'width') ~ '^\d{1,5}$' and (p_attachment ->> 'height') ~ '^\d{1,5}$', false) is false then
        raise exception 'Photos need their size.' using errcode = '22023';
      end if;
      v_attachment := jsonb_build_object(
        'path', v_upload.path, 'size', v_upload.size,
        'width', (p_attachment ->> 'width')::integer, 'height', (p_attachment ->> 'height')::integer,
        'thumb', case when char_length(p_attachment ->> 'thumb') <= 4000
                       and (p_attachment ->> 'thumb') ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$'
                      then p_attachment ->> 'thumb' end);
    elsif v_kind = 'voice' then
      if coalesce((p_attachment ->> 'duration') ~ '^\d{1,7}$', false) is false
         or (p_attachment ->> 'duration')::integer not between 500 and 1800000 then
        raise exception 'Voice notes are up to 30 minutes.' using errcode = '22023';
      end if;
      v_body := '';
      v_attachment := jsonb_build_object(
        'path', v_upload.path, 'size', v_upload.size, 'mime', v_upload.mime,
        'duration', (p_attachment ->> 'duration')::integer,
        'waveform', (select coalesce(jsonb_agg(least(greatest(w::integer, 0), 15)), '[]'::jsonb)
                     from (select w from jsonb_array_elements_text(
                             case when jsonb_typeof(p_attachment -> 'waveform') = 'array' then p_attachment -> 'waveform' else '[]' end) w
                           where w ~ '^\d{1,2}$' limit 64) x));
    else
      if char_length(btrim(coalesce(p_attachment ->> 'name', ''))) not between 1 and 200 then
        raise exception 'Documents need a name of up to 200 characters.' using errcode = '22023';
      end if;
      v_attachment := jsonb_build_object(
        'path', v_upload.path, 'size', v_upload.size, 'mime', v_upload.mime,
        'name', btrim(p_attachment ->> 'name'));
    end if;
  elsif v_kind = 'sticker' then
    v_body := '';
    if p_attachment ->> 'pack' = 'user' then
      if not exists (select 1 from messaging.stickers s where s.hash = p_attachment ->> 'id') then
        raise exception 'Unknown sticker.' using errcode = '22023';
      end if;
    elsif coalesce((p_attachment ->> 'pack') = 'fluent' and (p_attachment ->> 'id') ~ '^[a-z0-9_]{1,40}$', false) is false then
      raise exception 'Unknown sticker.' using errcode = '22023';
    end if;
    v_attachment := jsonb_build_object('pack', p_attachment ->> 'pack', 'id', p_attachment ->> 'id')
      || coalesce((select jsonb_build_object('animated', s.animated) from messaging.stickers s where s.hash = p_attachment ->> 'id'), '{}');
    -- Recents.
    insert into messaging.user_stickers as us (user_id, sticker, used_at)
    values (v_uid, (p_attachment ->> 'pack') || ':' || (p_attachment ->> 'id'), now())
    on conflict (user_id, sticker) do update set used_at = now();
  elsif v_kind = 'poll' then
    v_body := '';
    select jsonb_agg(btrim(o) order by n) into v_options
    from jsonb_array_elements_text(case when jsonb_typeof(p_attachment -> 'options') = 'array'
                                        then p_attachment -> 'options' else '[]'::jsonb end) with ordinality as x (o, n);
    if char_length(btrim(coalesce(p_attachment ->> 'question', ''))) not between 1 and 300 then
      raise exception 'Polls need a question of up to 300 characters.' using errcode = '22023';
    end if;
    if coalesce(jsonb_array_length(v_options), 0) not between 2 and 12
       or exists (select 1 from jsonb_array_elements_text(v_options) o where char_length(o) not between 1 and 100)
       or (select count(distinct lower(o)) from jsonb_array_elements_text(v_options) o) <> jsonb_array_length(v_options) then
      raise exception 'Polls need 2 to 12 different options of up to 100 characters.' using errcode = '22023';
    end if;
    v_attachment := jsonb_build_object(
      'question', btrim(p_attachment ->> 'question'), 'options', v_options,
      'multiple', coalesce((p_attachment ->> 'multiple')::boolean, false));
  elsif v_kind = 'contact' then
    v_body := '';
    if p_attachment ->> 'type' = 'student' then
      select p.user_id, p.full_name, p.avatar_path, coalesce(i.short_name, i.name) as institution into v_contact
      from identity.profiles p join identity.institutions i on i.id = p.institution_id
      where p.user_id = (p_attachment ->> 'user_id')::uuid and p.account_status = 'active'
        and p.name_confirmed_at is not null
        and not exists (select 1 from safety.blocks b
                        where (b.blocker_id = v_uid and b.blocked_id = p.user_id) or (b.blocker_id = p.user_id and b.blocked_id = v_uid));
      if v_contact.user_id is null then
        raise exception 'That student cannot be shared.' using errcode = '22023';
      end if;
      v_attachment := jsonb_build_object('type', 'student', 'user_id', v_contact.user_id, 'name', v_contact.full_name,
        'avatar_path', v_contact.avatar_path, 'institution', v_contact.institution);
    elsif p_attachment ->> 'type' = 'phone' then
      if char_length(btrim(coalesce(p_attachment ->> 'name', ''))) not between 1 and 100
         or jsonb_typeof(p_attachment -> 'phones') <> 'array'
         or jsonb_array_length(p_attachment -> 'phones') not between 1 and 5
         or exists (select 1 from jsonb_array_elements(p_attachment -> 'phones') ph
                    where coalesce(ph ->> 'number', '') !~ '^[+0-9 ()-]{3,30}$' or char_length(coalesce(ph ->> 'label', '')) > 30) then
        raise exception 'Contacts need a name and 1 to 5 phone numbers.' using errcode = '22023';
      end if;
      v_attachment := jsonb_build_object('type', 'phone', 'name', btrim(p_attachment ->> 'name'),
        'phones', (select jsonb_agg(jsonb_build_object('label', coalesce(ph ->> 'label', ''), 'number', ph ->> 'number'))
                   from jsonb_array_elements(p_attachment -> 'phones') ph));
    else
      raise exception 'Share a student or a phone contact.' using errcode = '22023';
    end if;
  else
    raise exception 'Unknown message kind.' using errcode = '22023';
  end if;

  select c.id, c.kind, c.slow_mode_seconds, c.announcement_only, m.role into v_conversation
  from messaging.conversations c
  join messaging.conversation_members m on m.conversation_id = c.id and m.user_id = v_uid
  where c.id = p_conversation_id;
  if v_conversation.id is null then
    raise exception 'You are not in this chat.' using errcode = '42501';
  end if;
  if v_conversation.announcement_only and v_conversation.role <> 'admin' then
    raise exception 'Only admins can post in this chat.' using errcode = '42501';
  end if;

  insert into ops.rate_limits as r (user_id, action, window_start, hits)
  values (v_uid, 'send_message', date_trunc('minute', now()), 1)
  on conflict on constraint rate_limits_pkey do update set hits = r.hits + 1
  returning r.hits into v_hits;
  if v_hits > 30 then
    raise exception 'You are sending messages too quickly. Wait a moment.' using errcode = 'PT429';
  end if;

  if v_conversation.slow_mode_seconds > 0 and v_conversation.role <> 'admin' and exists (
    select 1 from messaging.messages m
    where m.conversation_id = p_conversation_id and m.sender_id = v_uid
      and m.created_at > now() - make_interval(secs => v_conversation.slow_mode_seconds)) then
    raise exception 'Slow mode is on. Wait a little before sending again.' using errcode = 'PT429';
  end if;

  if v_conversation.kind = 'direct' then
    select * into v_direct from messaging.direct_conversations d where d.conversation_id = p_conversation_id for update;
    v_other := case when v_direct.user_low = v_uid then v_direct.user_high else v_direct.user_low end;
    if exists (select 1 from safety.blocks b
               where (b.blocker_id = v_uid and b.blocked_id = v_other) or (b.blocker_id = v_other and b.blocked_id = v_uid))
       or not exists (select 1 from identity.profiles p where p.user_id = v_other and p.account_status = 'active') then
      raise exception 'You cannot message this student.' using errcode = '42501';
    end if;
    if v_direct.request_status <> 'accepted' then
      if v_direct.initiated_by = v_uid then
        if exists (select 1 from messaging.messages m where m.conversation_id = p_conversation_id and m.sender_id = v_uid) then
          raise exception 'Your message request is waiting. You can send more once they accept.' using errcode = '22023';
        end if;
      else
        -- Replying to a request accepts it.
        update messaging.direct_conversations d set request_status = 'accepted', decided_at = now()
        where d.conversation_id = p_conversation_id;
      end if;
    end if;
  end if;

  -- The message replied to, from this chat.
  if p_reply_to_id is not null and not v_forwarded then
    select m.* into v_source from messaging.messages m
    where m.id = p_reply_to_id and m.conversation_id = p_conversation_id and m.deleted_at is null limit 1;
    if v_source.id is not null then
      v_reply := messaging.reply_snapshot(v_source);
    end if;
  end if;

  -- @mentions: members of this group only, up to 50.
  if p_mentions is not null and v_conversation.kind <> 'direct' then
    select array_agg(distinct m.user_id) into v_mentions
    from messaging.conversation_members m
    where m.conversation_id = p_conversation_id and m.user_id = any (p_mentions[1:50]) and m.user_id <> v_uid;
  end if;

  -- The actual time of saving (now() is the start of the transaction).
  insert into messaging.messages
    (id, conversation_id, sender_id, body, reply_to_id, kind, attachment, reply, forwarded, mentions, link, created_at)
  values
    (p_id, p_conversation_id, v_uid, v_body, case when v_reply is not null then p_reply_to_id end, v_kind, v_attachment,
     v_reply, v_forwarded, v_mentions, v_link, clock_timestamp())
  returning created_at into v_created;

  if v_upload_path is not null then
    update messaging.uploads u set message_id = p_id where u.path = v_upload_path;
  end if;
  if v_media_path is not null then
    insert into messaging.media_refs (path, conversation_id) values (v_media_path, p_conversation_id) on conflict do nothing;
  end if;

  update messaging.conversations c set
    last_message_id = p_id, last_message_at = v_created,
    last_message_preview = messaging.preview_text(v_kind, v_body, v_attachment), last_sender_id = v_uid
  where c.id = p_conversation_id;

  select p.full_name, p.avatar_path into v_sender from identity.profiles p where p.user_id = v_uid;
  v_payload := jsonb_build_object(
    'id', p_id, 'conversation_id', p_conversation_id, 'kind', v_conversation.kind,
    'sender_id', v_uid, 'sender_name', v_sender.full_name, 'sender_avatar', v_sender.avatar_path,
    'body', v_body, 'reply_to_id', case when v_reply is not null then p_reply_to_id end, 'created_at', v_created,
    'message_kind', v_kind, 'attachment', v_attachment, 'reply', v_reply, 'forwarded', v_forwarded,
    'mentions', to_jsonb(v_mentions), 'link', v_link);

  if v_conversation.kind = 'direct' then
    perform realtime.send(v_payload, 'message', 'user:' || v_uid, true);
    perform realtime.send(v_payload, 'message', 'user:' || v_other, true);
  else
    perform realtime.send(v_payload, 'message', 'chat:' || p_conversation_id, true);
  end if;

  return jsonb_build_object('id', p_id, 'created_at', v_created, 'duplicate', false,
    'attachment', v_attachment, 'reply', v_reply, 'forwarded', v_forwarded, 'link', v_link);
end;
$$;
grant execute on function api.send_message(uuid, uuid, text, uuid, text, jsonb, uuid, uuid[], jsonb) to authenticated;
