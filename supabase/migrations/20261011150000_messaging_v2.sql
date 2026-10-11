-- Messaging, second round: what students expect from WhatsApp.
--
--   reply        a snapshot of the message replied to travels with the reply (who, what kind,
--                the first 200 characters), so it shows even when the original is not loaded
--   reactions    one emoji per student per message (messaging.message_reactions)
--   forward      send_message(p_forward_from): the server copies the original (files are not
--                uploaded again; the new chat is granted access to the same file)
--   delete       for everyone (your own, within 2 days: content cleared, "This message was deleted")
--                or for me (messaging.hidden_messages, on all your devices)
--   edit         your own text and captions, within 15 minutes, marked "Edited"
--   star         messaging.starred_messages
--   delivered    direct chats: grey ✓✓ once the other phone has the message
--   mentions     @someone in a group notifies them even when the group is muted
--   pin          one pinned message per chat
--   link         a preview of the first link (made on the sender's phone)
--   voice        voice notes (kind 'voice', AAC in .m4a)
--   media        photos, documents and voice notes now live in a private bucket: reading one
--                needs a short-lived signed link, given only to members of a chat that has it
--                (messaging.media_refs)
--   presence     "last seen" and "online", for people you have a direct chat with, and only if
--                you share your own (as in WhatsApp)
--   stickers     a library per student: imported from WhatsApp or made from photos (stored once
--                per unique sticker, by its SHA-256), favourites and recents
--
-- Every live event goes through messaging.broadcast: to both students' inboxes in a direct chat,
-- or to the chat's own channel (only students with that chat open) in a group.

-- ---------------------------------------------------------------------------------------------
-- Tables and columns
-- ---------------------------------------------------------------------------------------------

alter table messaging.messages drop constraint messages_kind_check;
alter table messaging.messages add constraint messages_kind_check
  check (kind in ('text', 'image', 'file', 'voice', 'sticker', 'poll', 'contact'));
-- A message deleted for everyone keeps its row (so chats show "This message was deleted"), empty.
alter table messaging.messages drop constraint messages_body_check;
alter table messaging.messages add constraint messages_body_check
  check (char_length(body) <= 4000 and (kind <> 'text' or deleted_at is not null or char_length(body) >= 1));
alter table messaging.messages add column reply jsonb;
alter table messaging.messages add column forwarded boolean not null default false;
alter table messaging.messages add column mentions uuid[];
alter table messaging.messages add column link jsonb;

alter table messaging.uploads drop constraint uploads_kind_check;
alter table messaging.uploads add constraint uploads_kind_check check (kind in ('image', 'file', 'voice'));

alter table messaging.conversation_members add column delivered_at timestamptz;
alter table messaging.conversations add column pinned_message_id uuid;
alter table messaging.conversations add column pinned_at timestamptz;
alter table messaging.conversations add column pinned_by uuid references identity.profiles (user_id) on delete set null;
create index conversations_pinned_by_idx on messaging.conversations (pinned_by);

create table messaging.message_reactions (
  message_id uuid not null,
  conversation_id uuid not null references messaging.conversations (id) on delete cascade,
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index message_reactions_conversation_idx on messaging.message_reactions (conversation_id);
create index message_reactions_user_idx on messaging.message_reactions (user_id);
alter table messaging.message_reactions enable row level security;

create table messaging.hidden_messages (
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  message_id uuid not null,
  conversation_id uuid not null references messaging.conversations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
create index hidden_messages_conversation_idx on messaging.hidden_messages (conversation_id);
alter table messaging.hidden_messages enable row level security;

create table messaging.starred_messages (
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  message_id uuid not null,
  conversation_id uuid not null references messaging.conversations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
create index starred_messages_user_idx on messaging.starred_messages (user_id, created_at desc);
create index starred_messages_conversation_idx on messaging.starred_messages (conversation_id);
alter table messaging.starred_messages enable row level security;

-- Which chats may read each private file (the chat it was sent in, and any it was forwarded to).
create table messaging.media_refs (
  path text not null,
  conversation_id uuid not null references messaging.conversations (id) on delete cascade,
  primary key (path, conversation_id)
);
create index media_refs_conversation_idx on messaging.media_refs (conversation_id);
alter table messaging.media_refs enable row level security;

create table identity.presence (
  user_id uuid primary key references identity.profiles (user_id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  active boolean not null default false
);
alter table identity.presence enable row level security;
alter table identity.privacy_settings add column show_last_seen boolean not null default true;
grant update (show_last_seen) on identity.privacy_settings to authenticated;

-- Stickers uploaded by students, once per unique file (public bucket, stickers/<hash>.webp).
create table messaging.stickers (
  hash text primary key check (hash ~ '^[0-9a-f]{64}$'),
  size integer not null check (size between 1 and 1000000),
  animated boolean not null default false,
  created_by uuid references identity.profiles (user_id) on delete set null,
  created_at timestamptz not null default now()
);
create index stickers_created_by_idx on messaging.stickers (created_by);
alter table messaging.stickers enable row level security;

-- A student's stickers: the ones they imported or made (mine), favourites, and recents (used_at).
-- Built-in stickers are 'fluent:<name>', uploaded ones 'user:<hash>'.
create table messaging.user_stickers (
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  sticker text not null check (sticker ~ '^(fluent:[a-z0-9_]{1,40}|user:[0-9a-f]{64})$'),
  mine boolean not null default false,
  favourite boolean not null default false,
  used_at timestamptz,
  added_at timestamptz not null default now(),
  primary key (user_id, sticker)
);
alter table messaging.user_stickers enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

create or replace function messaging.preview_text(p_kind text, p_body text, p_attachment jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(case p_kind
    when 'image' then case when coalesce(p_body, '') <> '' then 'Photo: ' || p_body else 'Photo' end
    when 'file' then 'Document: ' || coalesce(p_attachment ->> 'name', 'file')
    when 'voice' then 'Voice message (' || ((coalesce((p_attachment ->> 'duration')::integer, 0) / 1000) / 60)::text || ':'
      || lpad(((coalesce((p_attachment ->> 'duration')::integer, 0) / 1000) % 60)::text, 2, '0') || ')'
    when 'sticker' then 'Sticker'
    when 'poll' then 'Poll: ' || coalesce(p_attachment ->> 'question', '')
    when 'contact' then 'Contact: ' || coalesce(p_attachment ->> 'name', '')
    else p_body
  end, 140);
$$;

create or replace function messaging.file_extension(p_mime text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_mime
    when 'image/jpeg' then 'jpg'
    when 'audio/mp4' then 'm4a'
    when 'application/pdf' then 'pdf'
    when 'application/msword' then 'doc'
    when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx'
    when 'application/vnd.ms-powerpoint' then 'ppt'
    when 'application/vnd.openxmlformats-officedocument.presentationml.presentation' then 'pptx'
    when 'application/vnd.ms-excel' then 'xls'
    when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'xlsx'
    when 'text/plain' then 'txt'
    when 'application/zip' then 'zip'
  end;
$$;

-- Sends a live event to whoever should see it now.
create or replace function messaging.broadcast(p_conversation_id uuid, p_event text, p_payload jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_direct record;
begin
  select d.user_low, d.user_high into v_direct from messaging.direct_conversations d where d.conversation_id = p_conversation_id;
  if v_direct.user_low is not null then
    perform realtime.send(p_payload, p_event, 'user:' || v_direct.user_low, true);
    perform realtime.send(p_payload, p_event, 'user:' || v_direct.user_high, true);
  else
    perform realtime.send(p_payload, p_event, 'chat:' || p_conversation_id, true);
  end if;
end;
$$;

-- The message, if it is in this chat, not deleted, and the caller may see the chat.
create or replace function messaging.visible_message(p_conversation_id uuid, p_message_id uuid)
returns messaging.messages
language sql
stable
security definer
set search_path = ''
as $$
  select m.* from messaging.messages m
  where m.id = p_message_id and m.conversation_id = p_conversation_id and m.deleted_at is null
    and messaging.is_member(p_conversation_id)
  limit 1;
$$;

-- What a reply shows of the message it answers.
create or replace function messaging.reply_snapshot(p_message messaging.messages)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_message.id,
    'sender_id', p_message.sender_id,
    'sender_name', (select p.full_name from identity.profiles p where p.user_id = p_message.sender_id),
    'kind', p_message.kind,
    'text', left(case when p_message.kind = 'text' then p_message.body
                      else messaging.preview_text(p_message.kind, p_message.body, p_message.attachment) end, 200),
    'thumb', case when p_message.kind = 'image' then p_message.attachment ->> 'thumb' end,
    'sticker', case when p_message.kind = 'sticker' then p_message.attachment end);
$$;

revoke execute on function messaging.broadcast(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function messaging.visible_message(uuid, uuid) from public, anon, authenticated;
revoke execute on function messaging.reply_snapshot(messaging.messages) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Uploads (adds voice notes)
-- ---------------------------------------------------------------------------------------------

create or replace function api.begin_chat_upload(p_conversation_id uuid, p_kind text, p_mime text, p_size integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ext text := messaging.file_extension(p_mime);
  v_hits integer;
  v_path text;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_kind not in ('image', 'file', 'voice') or v_ext is null
     or (p_kind = 'image') <> (p_mime = 'image/jpeg') or (p_kind = 'voice') <> (p_mime = 'audio/mp4') then
    raise exception 'You can send photos, voice notes, PDFs, Word, PowerPoint, Excel, text and zip files.' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0
     or p_size > (case p_kind when 'image' then 5000000 when 'voice' then 10000000 else 25000000 end) then
    raise exception 'Files can be up to 25 MB.' using errcode = '22023';
  end if;
  perform messaging.assert_can_post(p_conversation_id, v_uid);

  insert into ops.rate_limits as r (user_id, action, window_start, hits)
  values (v_uid, 'chat_upload', date_trunc('hour', now()), 1)
  on conflict on constraint rate_limits_pkey do update set hits = r.hits + 1
  returning r.hits into v_hits;
  if v_hits > 100 then
    raise exception 'You have sent a lot of files this hour. Try again later.' using errcode = 'PT429';
  end if;

  v_path := 'chat/' || p_conversation_id || '/' || ops.uuid_v7() || '.' || v_ext;
  insert into messaging.uploads (path, user_id, conversation_id, kind, mime, size)
  values (v_path, v_uid, p_conversation_id, p_kind, p_mime, p_size);
  return jsonb_build_object('path', v_path, 'mime', p_mime, 'size', p_size);
end;
$$;

-- Which of these private files the caller may read: those in (or forwarded to) chats they are in.
-- The media Edge Function signs short-lived links for exactly these.
create or replace function api.media_access(p_paths text[])
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct r.path from messaging.media_refs r
  join messaging.conversation_members m on m.conversation_id = r.conversation_id and m.user_id = (select auth.uid())
  where r.path = any (p_paths[1:100]) and (select identity.is_active_user());
$$;
grant execute on function api.media_access(text[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Sending
-- ---------------------------------------------------------------------------------------------

drop function api.send_message(uuid, uuid, text, uuid, text, jsonb);
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

-- ---------------------------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------------------------

drop function api.chat_messages(uuid, timestamptz, timestamptz, integer);
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
  deleted boolean,
  kind text,
  attachment jsonb,
  reply jsonb,
  forwarded boolean,
  mentions uuid[],
  link jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if not messaging.is_member(p_conversation_id) then
    raise exception 'You are not in this chat.' using errcode = '42501';
  end if;

  return query
  select m.id, m.sender_id, p.full_name, p.avatar_path,
    case when m.deleted_at is null then m.body end, m.reply_to_id, m.created_at, m.edited_at, m.deleted_at is not null,
    m.kind, case when m.deleted_at is null then m.attachment end,
    case when m.deleted_at is null then m.reply end, m.forwarded, m.mentions,
    case when m.deleted_at is null then m.link end
  from messaging.messages m left join identity.profiles p on p.user_id = m.sender_id
  where m.conversation_id = p_conversation_id
    and (p_after is null or m.created_at > p_after)
    and (p_before is null or m.created_at < p_before)
    and not exists (select 1 from messaging.hidden_messages h where h.user_id = v_uid and h.message_id = m.id)
  order by case when p_after is not null then m.created_at end asc,
           case when p_after is null then m.created_at end desc
  limit v_limit;
end;
$$;
grant execute on function api.chat_messages(uuid, timestamptz, timestamptz, integer) to authenticated;

drop function api.my_chats();
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
  created_at timestamptz,
  other_delivered_at timestamptz,
  pinned jsonb,
  my_role text
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
    me.role
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

-- ---------------------------------------------------------------------------------------------
-- Read and delivered (direct chats show ✓, grey ✓✓ delivered, red ✓✓ read)
-- ---------------------------------------------------------------------------------------------

create or replace function api.mark_delivered(p_conversation_id uuid, p_up_to timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_at timestamptz := least(coalesce(p_up_to, clock_timestamp()), clock_timestamp());
  v_done timestamptz;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if not exists (select 1 from messaging.direct_conversations d where d.conversation_id = p_conversation_id) then
    return; -- groups do not track delivery
  end if;
  update messaging.conversation_members m set delivered_at = v_at
  where m.conversation_id = p_conversation_id and m.user_id = v_uid
    and (m.delivered_at is null or m.delivered_at < v_at) and (m.last_read_at is null or m.last_read_at < v_at)
  returning m.delivered_at into v_done;
  if v_done is not null then
    perform messaging.broadcast(p_conversation_id, 'delivered',
      jsonb_build_object('conversation_id', p_conversation_id, 'user_id', v_uid, 'delivered_at', v_done));
  end if;
end;
$$;
grant execute on function api.mark_delivered(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Reactions
-- ---------------------------------------------------------------------------------------------

-- Reacts with one emoji, replaces your reaction, or (null) removes it.
create or replace function api.react(p_conversation_id uuid, p_message_id uuid, p_emoji text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_message messaging.messages;
  v_hits integer;
  v_emoji text := nullif(btrim(coalesce(p_emoji, '')), '');
begin
  v_message := messaging.visible_message(p_conversation_id, p_message_id);
  if v_uid is null or v_message.id is null then
    raise exception 'That message is not available.' using errcode = '22023';
  end if;
  -- An emoji: short, and no letters or digits.
  if v_emoji is not null and (char_length(v_emoji) > 16 or v_emoji ~ '[[:alnum:][:space:]<>]') then
    raise exception 'Reactions are a single emoji.' using errcode = '22023';
  end if;

  insert into ops.rate_limits as r (user_id, action, window_start, hits)
  values (v_uid, 'react', date_trunc('minute', now()), 1)
  on conflict on constraint rate_limits_pkey do update set hits = r.hits + 1
  returning r.hits into v_hits;
  if v_hits > 60 then
    raise exception 'You are reacting too quickly. Wait a moment.' using errcode = 'PT429';
  end if;

  if v_emoji is null then
    delete from messaging.message_reactions x where x.message_id = p_message_id and x.user_id = v_uid;
  else
    insert into messaging.message_reactions as x (message_id, conversation_id, user_id, emoji)
    values (p_message_id, p_conversation_id, v_uid, v_emoji)
    on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  end if;

  perform messaging.broadcast(p_conversation_id, 'reaction', jsonb_build_object(
    'conversation_id', p_conversation_id, 'message_id', p_message_id, 'user_id', v_uid, 'emoji', v_emoji));
end;
$$;
grant execute on function api.react(uuid, uuid, text) to authenticated;

-- Reactions on the messages on screen (up to 200 at once): each emoji, how many, and whether one
-- of them is yours.
create or replace function api.reactions(p_conversation_id uuid, p_message_ids uuid[])
returns table (message_id uuid, emoji text, count integer, mine boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
begin
  if not messaging.is_member(p_conversation_id) then
    raise exception 'You are not in this chat.' using errcode = '42501';
  end if;
  return query
  select x.message_id, x.emoji, count(*)::integer, bool_or(x.user_id = v_uid)
  from messaging.message_reactions x
  where x.conversation_id = p_conversation_id and x.message_id = any (p_message_ids[1:200])
  group by x.message_id, x.emoji
  order by x.message_id, count(*) desc, min(x.created_at);
end;
$$;
grant execute on function api.reactions(uuid, uuid[]) to authenticated;

-- Who reacted with what, for the reactions sheet.
create or replace function api.reaction_details(p_conversation_id uuid, p_message_id uuid)
returns table (user_id uuid, full_name text, avatar_path text, emoji text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not messaging.is_member(p_conversation_id) then
    raise exception 'You are not in this chat.' using errcode = '42501';
  end if;
  return query
  select p.user_id, p.full_name, p.avatar_path, x.emoji
  from messaging.message_reactions x join identity.profiles p on p.user_id = x.user_id
  where x.conversation_id = p_conversation_id and x.message_id = p_message_id
  order by x.created_at desc
  limit 500;
end;
$$;
grant execute on function api.reaction_details(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Delete, edit, star, pin
-- ---------------------------------------------------------------------------------------------

-- For everyone: your own message within 2 days; its content is cleared and everyone sees "This
-- message was deleted". For me: hidden on all your devices.
create or replace function api.delete_message(p_conversation_id uuid, p_message_id uuid, p_for_everyone boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_message messaging.messages;
begin
  v_message := messaging.visible_message(p_conversation_id, p_message_id);
  if v_uid is null or v_message.id is null then
    raise exception 'That message is not available.' using errcode = '22023';
  end if;

  if not coalesce(p_for_everyone, false) then
    insert into messaging.hidden_messages (user_id, message_id, conversation_id)
    values (v_uid, p_message_id, p_conversation_id) on conflict do nothing;
    delete from messaging.starred_messages s where s.user_id = v_uid and s.message_id = p_message_id;
    return;
  end if;

  if v_message.sender_id is distinct from v_uid then
    raise exception 'You can only delete your own messages for everyone.' using errcode = '42501';
  end if;
  if v_message.created_at < now() - interval '2 days' then
    raise exception 'Messages can be deleted for everyone for 2 days after sending.' using errcode = '22023';
  end if;

  update messaging.messages m set deleted_at = clock_timestamp(), body = '', attachment = null, link = null, reply = null
  where m.id = p_message_id and m.created_at = v_message.created_at;
  delete from messaging.message_reactions x where x.message_id = p_message_id;
  delete from messaging.starred_messages s where s.message_id = p_message_id;
  update messaging.conversations c set last_message_preview = 'This message was deleted'
  where c.id = p_conversation_id and c.last_message_id = p_message_id;
  update messaging.conversations c set pinned_message_id = null, pinned_at = null, pinned_by = null
  where c.id = p_conversation_id and c.pinned_message_id = p_message_id;

  perform messaging.broadcast(p_conversation_id, 'delete',
    jsonb_build_object('conversation_id', p_conversation_id, 'message_id', p_message_id));
end;
$$;
grant execute on function api.delete_message(uuid, uuid, boolean) to authenticated;

-- Your own text or caption, within 15 minutes.
create or replace function api.edit_message(p_conversation_id uuid, p_message_id uuid, p_body text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_message messaging.messages;
  v_body text := btrim(coalesce(p_body, ''));
  v_at timestamptz := clock_timestamp();
begin
  v_message := messaging.visible_message(p_conversation_id, p_message_id);
  if v_uid is null or v_message.id is null or v_message.sender_id is distinct from v_uid then
    raise exception 'You can only edit your own messages.' using errcode = '42501';
  end if;
  if v_message.kind not in ('text', 'image', 'file') then
    raise exception 'Only text and captions can be edited.' using errcode = '22023';
  end if;
  if v_message.created_at < now() - interval '15 minutes' then
    raise exception 'Messages can be edited for 15 minutes after sending.' using errcode = '22023';
  end if;
  if (v_message.kind = 'text' and char_length(v_body) not between 1 and 4000)
     or (v_message.kind <> 'text' and char_length(v_body) > 1024) then
    raise exception 'That is too long.' using errcode = '22023';
  end if;

  update messaging.messages m set body = v_body, edited_at = v_at, link = case when m.kind = 'text' then null else m.link end
  where m.id = p_message_id and m.created_at = v_message.created_at;
  update messaging.conversations c set last_message_preview = messaging.preview_text(v_message.kind, v_body, v_message.attachment)
  where c.id = p_conversation_id and c.last_message_id = p_message_id;

  perform messaging.broadcast(p_conversation_id, 'edit', jsonb_build_object(
    'conversation_id', p_conversation_id, 'message_id', p_message_id, 'body', v_body, 'edited_at', v_at));
  return v_at;
end;
$$;
grant execute on function api.edit_message(uuid, uuid, text) to authenticated;

create or replace function api.star_message(p_conversation_id uuid, p_message_id uuid, p_on boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or (messaging.visible_message(p_conversation_id, p_message_id)).id is null then
    raise exception 'That message is not available.' using errcode = '22023';
  end if;
  if coalesce(p_on, false) then
    insert into messaging.starred_messages (user_id, message_id, conversation_id)
    values (v_uid, p_message_id, p_conversation_id) on conflict do nothing;
  else
    delete from messaging.starred_messages s where s.user_id = v_uid and s.message_id = p_message_id;
  end if;
end;
$$;
grant execute on function api.star_message(uuid, uuid, boolean) to authenticated;

-- Your starred messages, newest first, from chats you are still in.
create or replace function api.starred_messages(p_before timestamptz default null, p_limit integer default 50)
returns table (
  conversation_id uuid,
  chat_title text,
  chat_kind text,
  id uuid,
  sender_id uuid,
  sender_name text,
  sender_avatar text,
  body text,
  kind text,
  attachment jsonb,
  link jsonb,
  created_at timestamptz,
  starred_at timestamptz
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
  select c.id,
    case when c.kind = 'direct' then (
      select p.full_name from messaging.direct_conversations d join identity.profiles p
        on p.user_id = case when d.user_low = v_uid then d.user_high else d.user_low end
      where d.conversation_id = c.id) else c.title end,
    c.kind, m.id, m.sender_id, sp.full_name, sp.avatar_path, m.body, m.kind, m.attachment, m.link, m.created_at, s.created_at
  from messaging.starred_messages s
  join messaging.conversations c on c.id = s.conversation_id
  join messaging.conversation_members cm on cm.conversation_id = c.id and cm.user_id = v_uid
  join lateral (select * from messaging.messages x where x.id = s.message_id and x.conversation_id = s.conversation_id
                  and x.deleted_at is null limit 1) m on true
  left join identity.profiles sp on sp.user_id = m.sender_id
  where s.user_id = v_uid and (p_before is null or s.created_at < p_before)
  order by s.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;
grant execute on function api.starred_messages(timestamptz, integer) to authenticated;

-- One pinned message per chat. Direct chats: either student. Groups: admins, or anyone in a
-- group of up to 300 (a batch); national groups need an admin.
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
  v_members integer;
  v_message messaging.messages;
  v_pinned jsonb;
begin
  select m.role, c.kind, c.member_count into v_role, v_kind, v_members
  from messaging.conversation_members m join messaging.conversations c on c.id = m.conversation_id
  where m.conversation_id = p_conversation_id and m.user_id = v_uid;
  if v_uid is null or v_role is null or not (select identity.is_active_user()) then
    raise exception 'You are not in this chat.' using errcode = '42501';
  end if;
  if v_kind <> 'direct' and v_role <> 'admin' and v_members > 300 then
    raise exception 'Only group admins can pin messages in large groups.' using errcode = '42501';
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

-- Photos, documents and voice notes shared in a chat, newest first: the group's files tab (and,
-- later, its module resources). p_kind: 'media' (photos), 'docs' or 'voice'.
create or replace function api.chat_files(p_conversation_id uuid, p_kind text, p_before timestamptz default null, p_limit integer default 60)
returns table (id uuid, kind text, body text, attachment jsonb, sender_name text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not messaging.is_member(p_conversation_id) then
    raise exception 'You are not in this chat.' using errcode = '42501';
  end if;
  return query
  select m.id, m.kind, m.body, m.attachment, p.full_name, m.created_at
  from messaging.messages m left join identity.profiles p on p.user_id = m.sender_id
  where m.conversation_id = p_conversation_id and m.deleted_at is null
    and m.kind = case p_kind when 'media' then 'image' when 'docs' then 'file' when 'voice' then 'voice' end
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 60), 1), 100);
end;
$$;
grant execute on function api.chat_files(uuid, text, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Last seen and online
-- ---------------------------------------------------------------------------------------------

-- The app calls this when it opens, every few minutes while open, and when it closes.
create or replace function api.set_presence(p_active boolean)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into identity.presence as x (user_id, last_seen_at, active)
  select (select auth.uid()), now(), coalesce(p_active, false)
  where (select identity.is_active_user())
  on conflict (user_id) do update set last_seen_at = now(), active = excluded.active;
$$;
grant execute on function api.set_presence(boolean) to authenticated;

-- Someone you have a direct chat with: online now, or when they were last seen. Nothing when
-- either of you hides last seen (if you hide yours, you do not see others', as in WhatsApp).
create or replace function api.presence(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'online', x.active and x.last_seen_at > now() - interval '4 minutes',
    'last_seen_at', x.last_seen_at)
  from identity.presence x
  where x.user_id = p_user_id
    and (select identity.is_active_user())
    and exists (select 1 from messaging.direct_conversations d
                where d.request_status = 'accepted'
                  and ((d.user_low = (select auth.uid()) and d.user_high = p_user_id)
                    or (d.user_high = (select auth.uid()) and d.user_low = p_user_id)))
    and coalesce((select s.show_last_seen from identity.privacy_settings s where s.user_id = p_user_id), true)
    and coalesce((select s.show_last_seen from identity.privacy_settings s where s.user_id = (select auth.uid())), true)
    and not exists (select 1 from safety.blocks b
                    where (b.blocker_id = p_user_id and b.blocked_id = (select auth.uid()))
                       or (b.blocker_id = (select auth.uid()) and b.blocked_id = p_user_id));
$$;
grant execute on function api.presence(uuid) to authenticated;

create or replace function api.privacy_extras()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'show_last_seen', coalesce((select s.show_last_seen from identity.privacy_settings s where s.user_id = (select auth.uid())), true),
    'message_previews', coalesce((select s.message_previews from identity.privacy_settings s where s.user_id = (select auth.uid())), true));
$$;
grant execute on function api.privacy_extras() to authenticated;

create or replace function api.set_show_last_seen(p_on boolean)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_result boolean;
begin
  update identity.privacy_settings s set show_last_seen = coalesce(p_on, true)
  where s.user_id = (select auth.uid())
  returning s.show_last_seen into v_result;
  if v_result is null then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return v_result;
end;
$$;
grant execute on function api.set_show_last_seen(boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Stickers
-- ---------------------------------------------------------------------------------------------

create or replace function api.my_stickers()
returns table (sticker text, mine boolean, favourite boolean, used_at timestamptz, animated boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select us.sticker, us.mine, us.favourite, us.used_at, coalesce(s.animated, false)
  from messaging.user_stickers us
  left join messaging.stickers s on us.sticker = 'user:' || s.hash
  where us.user_id = (select auth.uid())
  order by us.used_at desc nulls last, us.added_at desc
  limit 2000;
$$;
grant execute on function api.my_stickers() to authenticated;

-- Adds a sticker to your library (favourite, or kept as one of yours), or changes that.
create or replace function api.save_sticker(p_sticker text, p_favourite boolean default null, p_mine boolean default null)
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
  if p_sticker !~ '^(fluent:[a-z0-9_]{1,40}|user:[0-9a-f]{64})$'
     or (p_sticker like 'user:%' and not exists (select 1 from messaging.stickers s where 'user:' || s.hash = p_sticker)) then
    raise exception 'Unknown sticker.' using errcode = '22023';
  end if;
  insert into messaging.user_stickers as us (user_id, sticker, favourite, mine)
  values (v_uid, p_sticker, coalesce(p_favourite, false), coalesce(p_mine, false))
  on conflict (user_id, sticker) do update set
    favourite = coalesce(p_favourite, us.favourite), mine = coalesce(p_mine, us.mine);
  delete from messaging.user_stickers us
  where us.user_id = v_uid and us.sticker = p_sticker and not us.mine and not us.favourite and us.used_at is null;
end;
$$;
grant execute on function api.save_sticker(text, boolean, boolean) to authenticated;

-- Before uploading a sticker: is it already stored (then it is just added to your library), or
-- where should it go. 500 new stickers a day per student, enough to import a WhatsApp collection.
create or replace function api.begin_sticker_upload(p_hash text, p_size integer, p_animated boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_hits integer;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if coalesce(p_hash, '') !~ '^[0-9a-f]{64}$' or p_size is null or p_size not between 1 and 1000000 then
    raise exception 'Stickers are WebP images up to 1 MB.' using errcode = '22023';
  end if;
  if exists (select 1 from messaging.stickers s where s.hash = p_hash) then
    insert into messaging.user_stickers as us (user_id, sticker, mine) values (v_uid, 'user:' || p_hash, true)
    on conflict (user_id, sticker) do update set mine = true;
    return jsonb_build_object('exists', true, 'sticker', 'user:' || p_hash);
  end if;

  insert into ops.rate_limits as r (user_id, action, window_start, hits)
  values (v_uid, 'sticker_upload', date_trunc('day', now()), 1)
  on conflict on constraint rate_limits_pkey do update set hits = r.hits + 1
  returning r.hits into v_hits;
  if v_hits > 500 then
    raise exception 'That is a lot of new stickers for one day. The rest will follow tomorrow.' using errcode = 'PT429';
  end if;
  return jsonb_build_object('exists', false, 'path', 'stickers/' || p_hash || '.webp');
end;
$$;
grant execute on function api.begin_sticker_upload(text, integer, boolean) to authenticated;

-- After the media function has checked the uploaded file really is a WebP with this hash.
create or replace function api.commit_sticker(p_user_id uuid, p_hash text, p_size integer, p_animated boolean)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into messaging.stickers (hash, size, animated, created_by)
  values (p_hash, p_size, coalesce(p_animated, false), p_user_id) on conflict do nothing;
  insert into messaging.user_stickers as us (user_id, sticker, mine) values (p_user_id, 'user:' || p_hash, true)
  on conflict (user_id, sticker) do update set mine = true;
  return 'user:' || p_hash;
end;
$$;
revoke execute on function api.commit_sticker(uuid, text, integer, boolean) from public, anon, authenticated;
grant execute on function api.commit_sticker(uuid, text, integer, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Notifications: mentions break through mutes and the group throttle; a Reply button
-- ---------------------------------------------------------------------------------------------

drop trigger messages_queue_push on messaging.messages;
drop function messaging.queue_push();
drop function messaging.push_recipients(uuid, uuid);

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
     or not exists (select 1 from messaging.push_recipients(new.conversation_id, new.sender_id, new.mentions)) then
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
      n.user_id = any (coalesce(v_message.mentions, '{}')) as mentioned
    from notified n
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'to', t.token,
    'title', case when v_message.kind = 'direct' then v_message.sender_name else coalesce(v_message.title, 'Group chat') end,
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
