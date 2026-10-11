-- Push notifications for when the app is closed.
--
-- Each phone registers an Expo push token (api.register_push_token). When a message is saved, a
-- trigger checks whether anyone should hear about it and, only then, asks the `push` Edge
-- Function to send (pg_net: queued here, sent by a background worker after the sender's
-- transaction commits, so sending a message is not slowed down and a rolled-back message never
-- notifies anyone). The function calls api.push_batch, which picks the recipients, records that
-- they were notified and returns the notifications; it sends them through Expo's push service
-- (FCM on Android, APNs on iPhone) and removes tokens of uninstalled apps.
--
-- Who is notified:
--   direct chats -> every message, except from a request they ignored;
--   groups       -> once, then again only after they have read the chat or 15 minutes later,
--                   so a busy national group does not buzz thousands of phones per message;
--   never        -> the sender, muted chats, or someone who blocked the sender.
--
-- Setup outside migrations (once per project): Vault secrets `push_function_url` (the function's
-- URL) and `push_function_secret`, and the same secret as the function's PUSH_SECRET. Without
-- them the trigger does nothing, which keeps local development quiet.

create extension if not exists pg_net with schema extensions;

create table messaging.push_tokens (
  token text primary key check (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$'),
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  updated_at timestamptz not null default now()
);
create index push_tokens_user_idx on messaging.push_tokens (user_id);
-- Reached only through the functions below.
alter table messaging.push_tokens enable row level security;

-- When this member was last notified about this chat (the group throttle).
alter table messaging.conversation_members add column notified_at timestamptz;

-- Off: notifications say "New message" instead of showing the text on the lock screen.
alter table identity.privacy_settings add column message_previews boolean not null default true;
grant update (message_previews) on identity.privacy_settings to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Tokens
-- ---------------------------------------------------------------------------------------------

-- Called by the app after sign-in and whenever Expo hands it a new token. A phone that changes
-- account moves its token to the new account. Up to 10 phones per student.
create or replace function api.register_push_token(p_token text, p_platform text)
returns void
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
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$' then
    raise exception 'That is not an Expo push token.' using errcode = '22023';
  end if;
  if p_platform is null or p_platform not in ('android', 'ios') then
    raise exception 'Choose android or ios.' using errcode = '22023';
  end if;

  insert into messaging.push_tokens as t (token, user_id, platform)
  values (p_token, v_uid, p_platform)
  on conflict (token) do update set user_id = v_uid, platform = p_platform, updated_at = now();

  delete from messaging.push_tokens t
  where t.user_id = v_uid
    and t.token not in (select x.token from messaging.push_tokens x where x.user_id = v_uid order by x.updated_at desc limit 10);
end;
$$;
grant execute on function api.register_push_token(text, text) to authenticated;

-- Called by the app just before signing out, so this phone stops getting that account's messages.
create or replace function api.unregister_push_token(p_token text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from messaging.push_tokens t where t.token = p_token and t.user_id = (select auth.uid());
$$;
grant execute on function api.unregister_push_token(text) to authenticated;

create or replace function api.message_previews()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select s.message_previews from identity.privacy_settings s where s.user_id = (select auth.uid())), true);
$$;
grant execute on function api.message_previews() to authenticated;

create or replace function api.set_message_previews(p_on boolean)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_result boolean;
begin
  update identity.privacy_settings s set message_previews = coalesce(p_on, true)
  where s.user_id = (select auth.uid())
  returning s.message_previews into v_result;
  if v_result is null then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return v_result;
end;
$$;
grant execute on function api.set_message_previews(boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Who hears about a message
-- ---------------------------------------------------------------------------------------------

create or replace function messaging.push_recipients(p_conversation_id uuid, p_sender_id uuid)
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
    and (m.muted_until is null or m.muted_until <= now())
    and exists (select 1 from messaging.push_tokens t where t.user_id = m.user_id)
    and not exists (select 1 from safety.blocks b where b.blocker_id = m.user_id and b.blocked_id = p_sender_id)
    and case
      when c.kind = 'direct' then d.request_status <> 'ignored'
      else m.notified_at is null
        or m.notified_at <= coalesce(m.last_read_at, '-infinity'::timestamptz)
        or m.notified_at < now() - interval '15 minutes'
    end;
$$;

-- Picks the recipients of one message, marks them notified and returns Expo push messages.
-- Only the push Edge Function (service role) calls this.
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
    'data', jsonb_build_object('conversation_id', v_message.conversation_id, 'message_id', v_message.id),
    'channelId', 'messages',
    'sound', 'default',
    'priority', 'high',
    'ttl', 86400
  )), '[]'::jsonb)
  into v_result
  from notified n
  join messaging.push_tokens t on t.user_id = n.user_id
  left join identity.privacy_settings s on s.user_id = n.user_id;

  return v_result;
end;
$$;

-- Expo said these tokens belong to uninstalled apps (DeviceNotRegistered).
create or replace function api.drop_push_tokens(p_tokens text[])
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from messaging.push_tokens t where t.token = any (p_tokens);
$$;

revoke execute on function messaging.push_recipients(uuid, uuid) from public, anon, authenticated;
revoke execute on function api.push_batch(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function api.drop_push_tokens(text[]) from public, anon, authenticated;
grant execute on function api.push_batch(uuid, timestamptz) to service_role;
grant execute on function api.drop_push_tokens(text[]) to service_role;

-- ---------------------------------------------------------------------------------------------
-- The trigger
-- ---------------------------------------------------------------------------------------------

create or replace function messaging.queue_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  -- Cheap check first: most group messages reach nobody new (everyone was notified recently).
  if new.sender_id is null
     or not exists (select 1 from messaging.push_recipients(new.conversation_id, new.sender_id)) then
    return null;
  end if;

  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'push_function_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'push_function_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('message_id', new.id, 'created_at', new.created_at),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 10000
  );
  return null;
end;
$$;
revoke execute on function messaging.queue_push() from public, anon, authenticated;

create trigger messages_queue_push after insert on messaging.messages
  for each row execute function messaging.queue_push();
