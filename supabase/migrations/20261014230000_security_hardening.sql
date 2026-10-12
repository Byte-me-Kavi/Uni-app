-- Security review fixes.
--
-- 1. Realtime: a chat's channel (chat:<id>) carries messages, edits, deletions, pins and polls, sent
--    only by the database. Members could send on it too (for typing), and Realtime checks that right
--    once per channel, not per event, so a member could broadcast a fake edit, deletion or message to
--    the other person's phone. Typing moves to its own channel (typing:<id>); chat:<id> becomes
--    receive-only for everyone.
-- 2. Functions in the api schema could be run by anyone holding the app's public key, signed in or
--    not (each one checked who was calling, but nothing needed that surface). Now only signed-in
--    students can run them, except api.app_config (the minimum app version, read before sign-in).
-- 3. Link previews: a quota per student, and only for active accounts.

-- ---------------------------------------------------------------------------------------------
-- 1. Realtime topics
-- ---------------------------------------------------------------------------------------------

-- p_send: true to send on the topic, false to listen.
--   user:<me>      listen only (the database sends)
--   chat:<id>      listen only, for members (the database sends)
--   typing:<id>    listen and send, for both people in an accepted direct chat with no block
create or replace function messaging.can_use_topic(p_topic text, p_send boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_conversation uuid;
  v_kind text;
begin
  if v_uid is null or p_topic is null or not (select identity.is_active_user()) then
    return false;
  end if;
  if p_topic = 'user:' || v_uid then
    return not p_send;
  end if;
  if p_topic ~ '^chat:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_kind := 'chat';
  elsif p_topic ~ '^typing:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_kind := 'typing';
  else
    return false;
  end if;
  v_conversation := substr(p_topic, strpos(p_topic, ':') + 1)::uuid;
  if not exists (select 1 from messaging.conversation_members m where m.conversation_id = v_conversation and m.user_id = v_uid) then
    return false;
  end if;
  if v_kind = 'chat' then
    return not p_send;
  end if;
  return exists (
    select 1 from messaging.direct_conversations d
    where d.conversation_id = v_conversation and d.request_status = 'accepted'
      and not exists (select 1 from safety.blocks b
                      where (b.blocker_id = d.user_low and b.blocked_id = d.user_high)
                         or (b.blocker_id = d.user_high and b.blocked_id = d.user_low)));
end;
$$;

drop policy if exists "uni era: typing in my direct chats" on realtime.messages;
create policy "uni era: typing in my direct chats" on realtime.messages
  for insert to authenticated
  with check (realtime.messages.extension = 'broadcast' and messaging.can_use_topic((select realtime.topic()), true));

-- ---------------------------------------------------------------------------------------------
-- 2. The api schema: signed-in students only
-- ---------------------------------------------------------------------------------------------

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig, has_function_privilege('authenticated', p.oid, 'execute') as students
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.prokind = 'f'
  loop
    -- Students keep exactly what they could run before (some functions had it only through public).
    if f.students then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end;
$$;
-- New api functions still start open to everyone (Postgres's built-in default, which only a global
-- default could change, and that would also close the test helpers). So every new api function
-- revokes it where it is made: `revoke execute on function api.x(...) from public, anon;`.
-- supabase/tests/security_test.sql fails if any api function is left open.
grant execute on function api.app_config() to anon;

-- ---------------------------------------------------------------------------------------------
-- 3. Link previews
-- ---------------------------------------------------------------------------------------------

-- Called by the link-preview function with the student's token before it fetches a page: active
-- accounts only, up to 300 previews a day.
create or replace function api.link_preview_allowed()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  perform messaging.hit_limit('link_preview', 300, 'Too many link previews today.');
  return true;
end;
$$;
revoke execute on function api.link_preview_allowed() from public, anon;
grant execute on function api.link_preview_allowed() to authenticated;
