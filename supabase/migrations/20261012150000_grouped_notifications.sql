-- Notifications: one per chat instead of one per message. Each push carries the chat as its
-- Android tag (a new one replaces the chat's notification in the tray) and iOS thread (stacked per
-- chat), and the title counts the unread: "Kavindu Sandun (4 messages)". Otherwise unchanged.

create or replace function api.push_batch(p_message_id uuid, p_created_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_message record;
  v_text text;
  v_result jsonb;
begin
  select msg.id, msg.conversation_id, msg.sender_id, msg.body, msg.kind as message_kind, msg.attachment, msg.created_at,
         msg.mentions, c.kind, c.title, p.full_name as sender_name, d.request_status, d.initiated_by
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
  v_text := messaging.preview_text(v_message.message_kind, v_message.body, v_message.attachment);

  with notified as (
    update messaging.conversation_members m set notified_at = now()
    where m.conversation_id = v_message.conversation_id
      and m.user_id in (select r.user_id from messaging.push_recipients(v_message.conversation_id, v_message.sender_id, v_message.mentions) r)
    returning m.user_id
  ),
  recipients as (
    select n.user_id, messaging.unread_total(n.user_id) as badge,
      n.user_id = any (coalesce(v_message.mentions, '{}')) as mentioned,
      -- Unread in this chat (up to 99), for "Kavindu Sandun (4 messages)".
      (select count(*)::integer from (
         select 1 from messaging.messages um
         where um.conversation_id = v_message.conversation_id
           and um.created_at > coalesce(cm.last_read_at, cm.joined_at)
           and um.sender_id is distinct from n.user_id and um.deleted_at is null
         limit 99) u) as unread
    from notified n
    join messaging.conversation_members cm on cm.conversation_id = v_message.conversation_id and cm.user_id = n.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'to', t.token,
    'title', case when v_message.kind = 'direct' then v_message.sender_name else coalesce(v_message.title, 'Group chat') end
      || case when r.unread > 1 then ' (' || r.unread || ' messages)' else '' end,
    'body', left(case
      when not coalesce(s.message_previews, true) then
        case when r.mentioned then split_part(v_message.sender_name, ' ', 1) || ' mentioned you'
             when v_message.kind = 'direct' then 'New message' else 'New messages' end
      when v_message.kind = 'direct' and v_message.request_status = 'pending' then 'Message request: ' || v_text
      when v_message.kind = 'direct' then v_text
      when r.mentioned then split_part(v_message.sender_name, ' ', 1) || ' mentioned you: ' || v_text
      else split_part(v_message.sender_name, ' ', 1) || ': ' || v_text
    end, 180),
    'data', jsonb_build_object('conversation_id', v_message.conversation_id, 'message_id', v_message.id, 'badge', r.badge),
    'badge', r.badge,
    'channelId', 'messages',
    -- One notification per chat, as in WhatsApp: on Android a new one replaces the chat's last
    -- (its title counts the unread); on iPhone they stack into one group per chat.
    'tag', v_message.conversation_id,
    'threadId', v_message.conversation_id,
    'categoryId', case when v_message.kind = 'direct' and v_message.request_status = 'pending' then null else 'message' end,
    'sound', 'default',
    'priority', 'high',
    'ttl', 86400
  )), '[]'::jsonb)
  into v_result
  from recipients r
  join messaging.push_tokens t on t.user_id = r.user_id
  left join identity.privacy_settings s on s.user_id = r.user_id;

  return jsonb_strip_nulls(v_result);
end;
$$;
