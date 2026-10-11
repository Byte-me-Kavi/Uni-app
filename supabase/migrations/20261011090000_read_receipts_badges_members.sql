-- Read positions, app icon badges, group members and muting.
--
-- 1. Sending a message counts as reading the chat up to it (as in WhatsApp): replying to someone
--    means you saw what they wrote. Before this, a chat whose messages had already reached the
--    phone could be opened without the server hearing about it, so its unread count came back
--    and the sender never saw ✓✓.
-- 2. Push notifications carry the recipient's unread total for the app icon badge.
-- 3. api.chat_members lists a group's students (paged, by name) for the group details screen.
-- 4. api.set_muted mutes or unmutes a chat's notifications.

-- ---------------------------------------------------------------------------------------------
-- 1. Sending marks read
-- ---------------------------------------------------------------------------------------------

create or replace function messaging.sender_has_read()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sender_id is not null then
    update messaging.conversation_members m set last_read_at = new.created_at
    where m.conversation_id = new.conversation_id and m.user_id = new.sender_id
      and (m.last_read_at is null or m.last_read_at < new.created_at);
  end if;
  return null;
end;
$$;
revoke execute on function messaging.sender_has_read() from public, anon, authenticated;

-- Named to run before messages_queue_push (triggers fire in name order), so a notification never
-- counts the sender's own chat as unread.
create trigger messages_mark_sender_read after insert on messaging.messages
  for each row execute function messaging.sender_has_read();

-- ---------------------------------------------------------------------------------------------
-- 2. Unread total for the app icon
-- ---------------------------------------------------------------------------------------------

-- Unread messages across a student's chats (99 at most per chat), as the Chats tab counts them:
-- muted chats and requests they have not answered do not count, except as one each for requests.
create or replace function messaging.unread_total(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case
    when d.request_status = 'pending' and d.initiated_by <> p_user_id then 1
    when d.request_status in ('pending', 'ignored') then 0
    when m.muted_until > now() then 0
    else (select count(*) from (
      select 1 from messaging.messages x
      where x.conversation_id = m.conversation_id
        and x.created_at > coalesce(m.last_read_at, m.joined_at)
        and x.sender_id is distinct from p_user_id and x.deleted_at is null
      limit 99) u)
  end), 0)::integer
  from messaging.conversation_members m
  left join messaging.direct_conversations d on d.conversation_id = m.conversation_id
  where m.user_id = p_user_id;
$$;
revoke execute on function messaging.unread_total(uuid) from public, anon, authenticated;

create or replace function api.push_batch(p_message_id uuid, p_created_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_message record;
  v_result jsonb;
begin
  select msg.id, msg.conversation_id, msg.sender_id, msg.body, msg.created_at,
         c.kind, c.title, p.full_name as sender_name, d.request_status, d.initiated_by
  into v_message
  from messaging.messages msg
  join messaging.conversations c on c.id = msg.conversation_id
  left join messaging.direct_conversations d on d.conversation_id = c.id
  left join identity.profiles p on p.user_id = msg.sender_id
  where msg.id = p_message_id and msg.created_at = p_created_at
    and msg.deleted_at is null and msg.sender_id is not null;

  -- Deleted, or too old to be news (a backlog after an outage is not worth buzzing for).
  if v_message.id is null or v_message.created_at < now() - interval '10 minutes' then
    return '[]'::jsonb;
  end if;

  with notified as (
    update messaging.conversation_members m set notified_at = now()
    where m.conversation_id = v_message.conversation_id
      and m.user_id in (select r.user_id from messaging.push_recipients(v_message.conversation_id, v_message.sender_id) r)
    returning m.user_id
  ),
  recipients as (
    select n.user_id, messaging.unread_total(n.user_id) as badge from notified n
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'to', t.token,
    'title', case when v_message.kind = 'direct' then v_message.sender_name else coalesce(v_message.title, 'Group chat') end,
    'body', left(case
      when not coalesce(s.message_previews, true) then
        case when v_message.kind = 'direct' then 'New message' else 'New messages' end
      when v_message.kind = 'direct' and v_message.request_status = 'pending' then 'Message request: ' || v_message.body
      when v_message.kind = 'direct' then v_message.body
      else split_part(v_message.sender_name, ' ', 1) || ': ' || v_message.body
    end, 180),
    'data', jsonb_build_object('conversation_id', v_message.conversation_id, 'message_id', v_message.id, 'badge', r.badge),
    'badge', r.badge,
    'channelId', 'messages',
    'sound', 'default',
    'priority', 'high',
    'ttl', 86400
  )), '[]'::jsonb)
  into v_result
  from recipients r
  join messaging.push_tokens t on t.user_id = r.user_id
  left join identity.privacy_settings s on s.user_id = r.user_id;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Group members
-- ---------------------------------------------------------------------------------------------

-- A group's students by name, 50 at a time (p_after_name / p_after_id: the last row of the
-- previous page). Members only. Students who blocked you, or whom you blocked, are left out.
create or replace function api.chat_members(
  p_conversation_id uuid,
  p_after_name text default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns table (
  user_id uuid,
  full_name text,
  avatar_path text,
  institution text,
  is_admin boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if v_uid is null or not (select identity.is_active_user()) or not messaging.is_member(p_conversation_id) then
    raise exception 'You are not in this chat.' using errcode = '42501';
  end if;

  return query
  select p.user_id, p.full_name, p.avatar_path, coalesce(i.short_name, i.name), m.role = 'admin'
  from messaging.conversation_members m
  join identity.profiles p on p.user_id = m.user_id
  join identity.institutions i on i.id = p.institution_id
  where m.conversation_id = p_conversation_id
    and p.account_status = 'active'
    and (p_after_name is null or (p.full_name, p.user_id) > (p_after_name, p_after_id))
    and not exists (select 1 from safety.blocks b
                    where (b.blocker_id = v_uid and b.blocked_id = p.user_id)
                       or (b.blocker_id = p.user_id and b.blocked_id = v_uid))
  order by p.full_name, p.user_id
  limit v_limit;
end;
$$;
grant execute on function api.chat_members(uuid, text, uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. Muting
-- ---------------------------------------------------------------------------------------------

-- Mutes a chat's notifications for p_hours (null: until unmuted), or unmutes it (p_on false).
create or replace function api.set_muted(p_conversation_id uuid, p_on boolean, p_hours integer default null)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_until timestamptz;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_hours is not null and p_hours not between 1 and 8760 then
    raise exception 'Mute for 1 hour to a year.' using errcode = '22023';
  end if;

  update messaging.conversation_members m set muted_until = case
    when not coalesce(p_on, false) then null
    when p_hours is null then 'infinity'::timestamptz
    else now() + make_interval(hours => p_hours)
  end
  where m.conversation_id = p_conversation_id and m.user_id = v_uid
  returning m.muted_until into v_until;

  if not found then
    raise exception 'You are not in this chat.' using errcode = '42501';
  end if;
  return v_until;
end;
$$;
grant execute on function api.set_muted(uuid, boolean, integer) to authenticated;
