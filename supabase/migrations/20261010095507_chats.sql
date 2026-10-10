-- Chats: default groups (batch and national programme), direct messages with requests, sending,
-- history, read state, and live delivery over Supabase Realtime Broadcast.
--
-- Delivery design (Realtime counts every broadcast as 1 sent + 1 per receiving client):
--   * A message is saved first, then broadcast from this database in the same transaction
--     (realtime.send), so nobody ever sees a message that was not stored or that blocks,
--     requests or "who can message me" should have stopped.
--   * Direct messages go to each member's own channel, user:<id> (2 sends), which the app keeps
--     open while it is in the foreground. Group messages go once to chat:<conversation id>; only
--     clients that subscribed to that chat receive (and are counted).
--   * Typing is a client broadcast on chat:<id>, allowed in direct chats only; it never touches
--     the database.
--   * Realtime is best-effort. The database is the source of truth: on reconnect the app asks
--     for everything newer than the last message it has (api.chat_messages).

-- ---------------------------------------------------------------------------------------------
-- National programme groups. Universities name the same degree differently ("BSc in Computer
-- Science", "B.Sc. (Hons) Computer Science"), so each programme links to a national field
-- ("Computer Science"), and each field has one group chat for students from every university.
-- ---------------------------------------------------------------------------------------------
create table academics.fields (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 2 and 80),
  -- "Computer Science", "computer-science" and "ComputerScience" are one field.
  name_key text generated always as (lower(regexp_replace(name, '[^[:alnum:]]+', '', 'g'))) stored,
  -- Set by the Uni Era team when two fields turn out to be the same degree.
  merged_into_id bigint references academics.fields (id),
  created_at timestamptz not null default now(),
  constraint fields_name_key_unique unique (name_key)
);
create index fields_name_trgm_idx on academics.fields using gin (name extensions.gin_trgm_ops);
create index fields_merged_into_idx on academics.fields (merged_into_id);
alter table academics.fields enable row level security;
grant select on academics.fields to authenticated;
create policy "fields are visible to students" on academics.fields for select to authenticated using (true);

alter table academics.programmes add column field_id bigint references academics.fields (id);
create index programmes_field_idx on academics.programmes (field_id);

-- The field a programme name describes: the degree words are dropped.
--   "BSc in Computer Science", "B.Sc. (Hons) in Computer Science" -> "Computer Science"
--   "BSc Eng in Computer Engineering" -> "Computer Engineering"
-- Names that are only a degree ("MBBS", "Bachelor of Arts") stay as they are.
create or replace function academics.field_name(p_programme text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_programme, ''), '\s+', ' ', 'g'));
  v_field text;
begin
  v_field := regexp_replace(v_name,
    '^(bachelor\s+of(\s+(science|arts|engineering|technology|commerce|business\s+administration|information\s+technology))?'
    || '|b\.?\s?(sc|a|eng|tech|com|ba|it|ed)\.?(\s?\(?eng\)?\.?)?)'
    || '\s*(\((hons|special|honou?rs)\.?\)|(hons|special|honou?rs)\.?)?\s*((in|of)\s+)?(?=\S)', '', 'i');
  v_field := btrim(regexp_replace(v_field, '\s*(\((hons|special|honou?rs|general)\.?\)|honou?rs|degree)\s*$', '', 'i'));
  if char_length(v_field) < 2 then
    return v_name;
  end if;
  -- All lower case as typed: give it capitals. Otherwise keep the student's own casing.
  return case when v_field = lower(v_field) then initcap(v_field) else v_field end;
end;
$$;

-- Links a programme to its field (an exact name match, else a near-identical one, else a new
-- field) and returns it.
create or replace function academics.ensure_field(p_programme_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_field bigint;
  v_programme text;
  v_name text;
begin
  select pr.field_id, pr.name into v_field, v_programme from academics.programmes pr where pr.id = p_programme_id;
  if v_field is not null then
    select coalesce(f.merged_into_id, f.id) into v_field from academics.fields f where f.id = v_field;
    return v_field;
  end if;

  v_name := academics.field_name(v_programme);
  select f.id into v_field from academics.fields f
  where f.name_key = lower(regexp_replace(v_name, '[^[:alnum:]]+', '', 'g')) and f.merged_into_id is null;
  if v_field is null then
    select f.id into v_field from academics.fields f
    where f.merged_into_id is null and extensions.similarity(f.name, v_name) >= 0.75
    order by extensions.similarity(f.name, v_name) desc
    limit 1;
  end if;
  if v_field is null then
    insert into academics.fields (name) values (v_name) on conflict (name_key) do nothing;
    select f.id into v_field from academics.fields f
    where f.name_key = lower(regexp_replace(v_name, '[^[:alnum:]]+', '', 'g'));
  end if;

  update academics.programmes pr set field_id = v_field where pr.id = p_programme_id;
  return v_field;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Conversations: the programme kind, and a summary for the chat list (one row read per chat)
-- ---------------------------------------------------------------------------------------------
alter table messaging.conversations drop constraint conversations_kind_check;
alter table messaging.conversations add constraint conversations_kind_check
  check (kind in ('direct', 'group', 'cohort', 'programme', 'module', 'kuppi'));
alter table messaging.conversations add column field_id bigint unique references academics.fields (id) on delete cascade;
alter table messaging.conversations drop constraint conversations_scope;
alter table messaging.conversations add constraint conversations_scope check (
  (kind = 'cohort') = (cohort_id is not null)
  and (kind = 'programme') = (field_id is not null)
  and (kind = 'module') = (module_id is not null)
  and (kind = 'kuppi') = (session_id is not null)
);
alter table messaging.conversations
  add column last_message_id uuid,
  add column last_message_at timestamptz,
  add column last_message_preview text,
  add column last_sender_id uuid references identity.profiles (user_id) on delete set null,
  add column member_count integer not null default 0 check (member_count >= 0);
create index conversations_last_sender_idx on messaging.conversations (last_sender_id);

-- Group chat titles: batches carry their university; programme groups are national.
create or replace function messaging.name_batch_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'cohort' then
    new.title := left(academics.batch_name(new.cohort_id), 80);
  elsif new.kind = 'programme' then
    new.title := (select left(f.name, 80) from academics.fields f where f.id = new.field_id);
  end if;
  return new;
end;
$$;

-- Member counts, for the chat header ("1,204 members") and to keep large groups off live updates.
create or replace function messaging.count_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update messaging.conversations c set member_count = c.member_count + 1 where c.id = new.conversation_id;
  else
    update messaging.conversations c set member_count = greatest(c.member_count - 1, 0) where c.id = old.conversation_id;
  end if;
  return null;
end;
$$;
create trigger conversation_members_count after insert or delete on messaging.conversation_members
  for each row execute function messaging.count_members();
update messaging.conversations c set member_count = (
  select count(*) from messaging.conversation_members m where m.conversation_id = c.id);

-- Joining a batch also joins the national group for its field; leaving the batch leaves both.
create or replace function messaging.sync_programme_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_field bigint;
  v_conversation uuid;
begin
  if tg_op = 'DELETE' then
    delete from messaging.conversation_members m
    using messaging.conversations c
    where m.conversation_id = c.id and m.user_id = old.user_id
      and (c.cohort_id = old.cohort_id or c.field_id = (
        select academics.ensure_field(co.programme_id) from academics.cohorts co where co.id = old.cohort_id));
    return null;
  end if;

  select academics.ensure_field(co.programme_id) into v_field from academics.cohorts co where co.id = new.cohort_id;
  insert into messaging.conversations (kind, field_id) values ('programme', v_field) on conflict (field_id) do nothing;
  select c.id into v_conversation from messaging.conversations c where c.field_id = v_field;
  insert into messaging.conversation_members (conversation_id, user_id) values (v_conversation, new.user_id)
  on conflict do nothing;
  return null;
end;
$$;
create trigger cohort_members_programme_chat after insert or delete on academics.cohort_members
  for each row execute function messaging.sync_programme_chat();

-- Students already in a batch.
do $$
declare r record;
begin
  for r in select m.user_id, m.cohort_id from academics.cohort_members m loop
    insert into messaging.conversations (kind, field_id)
    select 'programme', academics.ensure_field(co.programme_id) from academics.cohorts co where co.id = r.cohort_id
    on conflict (field_id) do nothing;
    insert into messaging.conversation_members (conversation_id, user_id)
    select c.id, r.user_id from messaging.conversations c
    join academics.cohorts co on co.id = r.cohort_id
    join academics.programmes pr on pr.id = co.programme_id
    where c.field_id = pr.field_id
    on conflict do nothing;
  end loop;
end $$;

revoke execute on function academics.ensure_field(bigint) from public, anon, authenticated;
revoke execute on function messaging.name_batch_chat() from public, anon, authenticated;
revoke execute on function messaging.count_members() from public, anon, authenticated;
revoke execute on function messaging.sync_programme_chat() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Direct messages
-- ---------------------------------------------------------------------------------------------

-- Opens (or finds) the direct chat with another student. Students at your university, and your
-- batchmates, go straight to their chats; anyone else lands in their Requests, and you can send
-- one message until they accept. Their "who can message me" setting and blocks apply.
create or replace function api.start_direct(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_me record;
  v_them record;
  v_setting text;
  v_low uuid;
  v_high uuid;
  v_conversation uuid;
  v_status text;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_user_id is null or p_user_id = v_uid then
    raise exception 'You cannot message yourself.' using errcode = '22023';
  end if;

  select p.user_id, p.full_name, p.institution_id, p.account_status, m.cohort_id into v_them
  from identity.profiles p left join academics.cohort_members m on m.user_id = p.user_id
  where p.user_id = p_user_id;
  if v_them.user_id is null or v_them.account_status <> 'active'
     or exists (select 1 from safety.blocks b
                where (b.blocker_id = v_uid and b.blocked_id = p_user_id) or (b.blocker_id = p_user_id and b.blocked_id = v_uid)) then
    raise exception 'You cannot message this student.' using errcode = '42501';
  end if;

  v_low := least(v_uid, p_user_id);
  v_high := greatest(v_uid, p_user_id);
  select d.conversation_id, d.request_status into v_conversation, v_status
  from messaging.direct_conversations d where d.user_low = v_low and d.user_high = v_high;
  if v_conversation is not null then
    return jsonb_build_object('conversation_id', v_conversation, 'request_status', v_status);
  end if;

  select p.institution_id, m.cohort_id into v_me
  from identity.profiles p left join academics.cohort_members m on m.user_id = p.user_id
  where p.user_id = v_uid;
  select coalesce(s.who_can_message, 'my_institution') into v_setting
  from identity.privacy_settings s where s.user_id = p_user_id;
  v_setting := coalesce(v_setting, 'my_institution');

  if v_setting = 'nobody'
     or (v_setting = 'my_cohort' and (v_me.cohort_id is null or v_me.cohort_id is distinct from v_them.cohort_id))
     or (v_setting = 'my_institution' and v_me.institution_id <> v_them.institution_id) then
    raise exception '% is not accepting messages from you.', split_part(v_them.full_name, ' ', 1) using errcode = '42501';
  end if;

  v_status := case when v_me.institution_id = v_them.institution_id then 'accepted' else 'pending' end;
  insert into messaging.conversations (kind, created_by) values ('direct', v_uid) returning id into v_conversation;
  insert into messaging.direct_conversations (conversation_id, user_low, user_high, initiated_by, request_status)
  values (v_conversation, v_low, v_high, v_uid, v_status)
  on conflict (user_low, user_high) do nothing;
  if not found then
    -- Someone opened the same chat a moment ago: use theirs.
    delete from messaging.conversations c where c.id = v_conversation;
    select d.conversation_id, d.request_status into v_conversation, v_status
    from messaging.direct_conversations d where d.user_low = v_low and d.user_high = v_high;
    return jsonb_build_object('conversation_id', v_conversation, 'request_status', v_status);
  end if;
  insert into messaging.conversation_members (conversation_id, user_id) values (v_conversation, v_uid), (v_conversation, p_user_id);
  return jsonb_build_object('conversation_id', v_conversation, 'request_status', v_status);
end;
$$;
grant execute on function api.start_direct(uuid) to authenticated;

-- Accept or ignore a message request. Ignored requests disappear for you; the sender is not told.
create or replace function api.respond_request(p_conversation_id uuid, p_accept boolean)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text := case when p_accept then 'accepted' else 'ignored' end;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update messaging.direct_conversations d set request_status = v_status, decided_at = now()
  where d.conversation_id = p_conversation_id and d.initiated_by <> v_uid and v_uid in (d.user_low, d.user_high)
    and d.request_status <> 'accepted';
  if not found then
    raise exception 'No request to answer.' using errcode = 'P0002';
  end if;
  return v_status;
end;
$$;
grant execute on function api.respond_request(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Sending
-- ---------------------------------------------------------------------------------------------

-- Saves a message and delivers it live. p_id is made on the phone (UUIDv7), so a retry after a
-- dropped connection finds the saved message instead of creating a second one.
create or replace function api.send_message(p_conversation_id uuid, p_id uuid, p_body text, p_reply_to_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_conversation record;
  v_direct record;
  v_other uuid;
  v_hits integer;
  v_created timestamptz;
  v_sender record;
  v_payload jsonb;
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

  if char_length(v_body) not between 1 and 4000 then
    raise exception 'Messages are 1 to 4000 characters.' using errcode = '22023';
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

  if v_conversation.slow_mode_seconds > 0 and exists (
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

  -- The actual time of saving (now() is the start of the transaction).
  insert into messaging.messages (id, conversation_id, sender_id, body, reply_to_id, created_at)
  values (p_id, p_conversation_id, v_uid, v_body, p_reply_to_id, clock_timestamp())
  returning created_at into v_created;

  update messaging.conversations c set
    last_message_id = p_id, last_message_at = v_created, last_message_preview = left(v_body, 140), last_sender_id = v_uid
  where c.id = p_conversation_id;

  select p.full_name, p.avatar_path into v_sender from identity.profiles p where p.user_id = v_uid;
  v_payload := jsonb_build_object(
    'id', p_id, 'conversation_id', p_conversation_id, 'kind', v_conversation.kind,
    'sender_id', v_uid, 'sender_name', v_sender.full_name, 'sender_avatar', v_sender.avatar_path,
    'body', v_body, 'reply_to_id', p_reply_to_id, 'created_at', v_created);

  if v_conversation.kind = 'direct' then
    perform realtime.send(v_payload, 'message', 'user:' || v_uid, true);
    perform realtime.send(v_payload, 'message', 'user:' || v_other, true);
  else
    perform realtime.send(v_payload, 'message', 'chat:' || p_conversation_id, true);
  end if;

  return jsonb_build_object('id', p_id, 'created_at', v_created, 'duplicate', false);
end;
$$;
grant execute on function api.send_message(uuid, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------------------------

-- The chat list in one request: last message, unread count (up to 100) and, for direct chats, the
-- other student and how far they have read (for ✓✓).
create or replace function api.my_chats()
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
  created_at timestamptz
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
    c.member_count, me.last_read_at, om.last_read_at, c.created_at
  from messaging.conversation_members me
  join messaging.conversations c on c.id = me.conversation_id
  left join messaging.direct_conversations d on d.conversation_id = c.id
  left join identity.profiles op on c.kind = 'direct'
    and op.user_id = case when d.user_low = v_uid then d.user_high else d.user_low end
  left join messaging.conversation_members om on om.conversation_id = c.id and om.user_id = op.user_id
  left join identity.profiles ls on ls.user_id = c.last_sender_id
  where me.user_id = v_uid
    and (c.kind <> 'direct' or c.last_message_id is not null)
    and not coalesce(d.request_status = 'ignored' and d.initiated_by <> v_uid, false)
    and not exists (select 1 from safety.blocks b where b.blocker_id = v_uid and b.blocked_id = op.user_id)
  order by coalesce(c.last_message_at, c.created_at) desc;
end;
$$;
grant execute on function api.my_chats() to authenticated;

-- Messages in a chat. Newest first (p_before pages back through history), or, with p_after,
-- everything newer than the phone already has, oldest first (catching up after a reconnect).
create or replace function api.chat_messages(
  p_conversation_id uuid,
  p_after timestamptz default null,
  p_before timestamptz default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  sender_id uuid,
  sender_name text,
  sender_avatar text,
  body text,
  reply_to_id uuid,
  created_at timestamptz,
  edited_at timestamptz,
  deleted boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if not messaging.is_member(p_conversation_id) then
    raise exception 'You are not in this chat.' using errcode = '42501';
  end if;

  if p_after is not null then
    return query
    select m.id, m.sender_id, p.full_name, p.avatar_path,
      case when m.deleted_at is null then m.body end, m.reply_to_id, m.created_at, m.edited_at, m.deleted_at is not null
    from messaging.messages m left join identity.profiles p on p.user_id = m.sender_id
    where m.conversation_id = p_conversation_id and m.created_at > p_after
    order by m.created_at asc
    limit v_limit;
  else
    return query
    select m.id, m.sender_id, p.full_name, p.avatar_path,
      case when m.deleted_at is null then m.body end, m.reply_to_id, m.created_at, m.edited_at, m.deleted_at is not null
    from messaging.messages m left join identity.profiles p on p.user_id = m.sender_id
    where m.conversation_id = p_conversation_id and (p_before is null or m.created_at < p_before)
    order by m.created_at desc
    limit v_limit;
  end if;
end;
$$;
grant execute on function api.chat_messages(uuid, timestamptz, timestamptz, integer) to authenticated;

-- Moves the caller's read position forward (never back). In direct chats the other student is
-- told, for ✓✓. The app calls this at most every few seconds while a chat is open.
create or replace function api.mark_read(p_conversation_id uuid, p_up_to timestamptz)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_read timestamptz;
  v_other uuid;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update messaging.conversation_members m
  set last_read_at = least(coalesce(p_up_to, clock_timestamp()), clock_timestamp())
  where m.conversation_id = p_conversation_id and m.user_id = v_uid
    and (m.last_read_at is null or m.last_read_at < least(coalesce(p_up_to, clock_timestamp()), clock_timestamp()))
  returning m.last_read_at into v_read;
  if v_read is null then
    select m.last_read_at into v_read from messaging.conversation_members m
    where m.conversation_id = p_conversation_id and m.user_id = v_uid;
    return v_read;
  end if;

  select case when d.user_low = v_uid then d.user_high else d.user_low end into v_other
  from messaging.direct_conversations d where d.conversation_id = p_conversation_id;
  if v_other is not null then
    perform realtime.send(
      jsonb_build_object('conversation_id', p_conversation_id, 'user_id', v_uid, 'last_read_at', v_read),
      'read', 'user:' || v_other, true);
  end if;
  return v_read;
end;
$$;
grant execute on function api.mark_read(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Who may listen and send on which Realtime channel. Checked when a channel is joined and cached
-- for the connection, so it costs nothing per message.
--   user:<your id>   your direct messages and read receipts (listen only)
--   chat:<id>        a chat you are in (listen); typing (send) in accepted direct chats only
-- ---------------------------------------------------------------------------------------------
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
begin
  if v_uid is null or p_topic is null or not (select identity.is_active_user()) then
    return false;
  end if;
  if p_topic = 'user:' || v_uid then
    return not p_send;
  end if;
  if p_topic !~ '^chat:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_conversation := substr(p_topic, 6)::uuid;
  if not exists (select 1 from messaging.conversation_members m where m.conversation_id = v_conversation and m.user_id = v_uid) then
    return false;
  end if;
  return not p_send or exists (
    select 1 from messaging.direct_conversations d
    where d.conversation_id = v_conversation and d.request_status = 'accepted'
      and not exists (select 1 from safety.blocks b
                      where (b.blocker_id = d.user_low and b.blocked_id = d.user_high)
                         or (b.blocker_id = d.user_high and b.blocked_id = d.user_low)));
end;
$$;
grant execute on function messaging.can_use_topic(text, boolean) to authenticated;

create policy "uni era: listen to my inbox and my chats" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension = 'broadcast' and messaging.can_use_topic((select realtime.topic()), false));

create policy "uni era: typing in my direct chats" on realtime.messages
  for insert to authenticated
  with check (realtime.messages.extension = 'broadcast' and messaging.can_use_topic((select realtime.topic()), true));
