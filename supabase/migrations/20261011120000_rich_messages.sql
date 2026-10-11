-- Rich messages: photos, documents, stickers, polls and contacts.
--
-- A message now has a kind and, for everything but text, an attachment (jsonb):
--   image    {path, width, height, size, thumb}   thumb: a tiny JPEG (data URI) shown while loading
--   file     {path, name, size, mime}             PDF, Word, PowerPoint, Excel, text, zip
--   sticker  {pack, id}                           drawn from the app's built-in packs
--   poll     {question, options[], multiple}      votes in messaging.poll_votes
--   contact  {type: 'student', user_id, name, avatar_path, institution}
--            {type: 'phone', name, phones[{label, number}]}
-- Photos and documents go straight from the phone to Cloudflare R2 with a short-lived signed URL
-- (the `media` Edge Function). api.begin_chat_upload records each upload against the sender and
-- the chat, and send_message only accepts an upload made by the sender for that chat, so nobody
-- can attach someone else's file. Every upload is listed in messaging.uploads by chat, which is
-- what a group's shared files (and later, module resources) will be built from.

alter table messaging.messages add column kind text not null default 'text'
  check (kind in ('text', 'image', 'file', 'sticker', 'poll', 'contact'));
alter table messaging.messages add column attachment jsonb;
alter table messaging.messages drop constraint messages_body_check;
-- Text needs words; other kinds may carry a caption or nothing.
alter table messaging.messages add constraint messages_body_check
  check (char_length(body) <= 4000 and (kind <> 'text' or char_length(body) >= 1));

create table messaging.uploads (
  path text primary key,
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  conversation_id uuid not null references messaging.conversations (id) on delete cascade,
  kind text not null check (kind in ('image', 'file')),
  mime text not null,
  size integer not null check (size > 0),
  message_id uuid, -- set when the message is sent; uploads never sent can be cleaned up
  created_at timestamptz not null default now()
);
create index uploads_conversation_idx on messaging.uploads (conversation_id, created_at desc);
create index uploads_user_idx on messaging.uploads (user_id);
alter table messaging.uploads enable row level security;

create table messaging.poll_votes (
  message_id uuid not null,
  conversation_id uuid not null references messaging.conversations (id) on delete cascade,
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  options smallint[] not null check (cardinality(options) between 1 and 12),
  voted_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index poll_votes_conversation_idx on messaging.poll_votes (conversation_id);
create index poll_votes_user_idx on messaging.poll_votes (user_id);
alter table messaging.poll_votes enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- What the chat list and notifications show for a message.
create or replace function messaging.preview_text(p_kind text, p_body text, p_attachment jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(case p_kind
    when 'image' then case when coalesce(p_body, '') <> '' then 'Photo: ' || p_body else 'Photo' end
    when 'file' then 'Document: ' || coalesce(p_attachment ->> 'name', 'file')
    when 'sticker' then 'Sticker'
    when 'poll' then 'Poll: ' || coalesce(p_attachment ->> 'question', '')
    when 'contact' then 'Contact: ' || coalesce(p_attachment ->> 'name', '')
    else p_body
  end, 140);
$$;

-- The documents students can share, by type, with the extension the file is stored under.
create or replace function messaging.file_extension(p_mime text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_mime
    when 'image/jpeg' then 'jpg'
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

-- Raises unless the caller may post in this chat now: a member, and for direct chats, not
-- blocked either way and not waiting on a request they already used.
create or replace function messaging.assert_can_post(p_conversation_id uuid, p_uid uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_direct record;
  v_other uuid;
begin
  if not exists (select 1 from messaging.conversation_members m
                 where m.conversation_id = p_conversation_id and m.user_id = p_uid) then
    raise exception 'You are not in this chat.' using errcode = '42501';
  end if;
  select * into v_direct from messaging.direct_conversations d where d.conversation_id = p_conversation_id;
  if v_direct.conversation_id is null then
    return;
  end if;
  v_other := case when v_direct.user_low = p_uid then v_direct.user_high else v_direct.user_low end;
  if exists (select 1 from safety.blocks b
             where (b.blocker_id = p_uid and b.blocked_id = v_other) or (b.blocker_id = v_other and b.blocked_id = p_uid)) then
    raise exception 'You cannot message this student.' using errcode = '42501';
  end if;
  if v_direct.request_status <> 'accepted' and v_direct.initiated_by = p_uid
     and exists (select 1 from messaging.messages m where m.conversation_id = p_conversation_id and m.sender_id = p_uid) then
    raise exception 'Your message request is waiting. You can send more once they accept.' using errcode = '22023';
  end if;
end;
$$;

-- Votes per option and how many students voted.
create or replace function messaging.poll_counts(p_message_id uuid, p_options integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'counts', (
      select coalesce(jsonb_agg(coalesce(t.n, 0) order by i), '[]'::jsonb)
      from generate_series(0, p_options - 1) i
      left join (
        select o, count(*)::integer n
        from messaging.poll_votes v, unnest(v.options) o
        where v.message_id = p_message_id
        group by o
      ) t on t.o = i),
    'voters', (select count(*)::integer from messaging.poll_votes v where v.message_id = p_message_id));
$$;

revoke execute on function messaging.assert_can_post(uuid, uuid) from public, anon, authenticated;
revoke execute on function messaging.poll_counts(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Uploads
-- ---------------------------------------------------------------------------------------------

-- Reserves a path for one photo or document in this chat. Called by the media Edge Function with
-- the student's own token; the function then signs an upload URL for exactly this path, type and
-- size. Photos are resized on the phone (about 200 to 500 KB); documents up to 25 MB.
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
  if p_kind not in ('image', 'file') or v_ext is null or (p_kind = 'image') <> (p_mime = 'image/jpeg') then
    raise exception 'You can send photos, PDFs, Word, PowerPoint, Excel, text and zip files.' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or p_size > (case when p_kind = 'image' then 5000000 else 25000000 end) then
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
grant execute on function api.begin_chat_upload(uuid, text, text, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Sending (replaces the text-only version; same checks, plus kinds)
-- ---------------------------------------------------------------------------------------------

drop function api.send_message(uuid, uuid, text, uuid);
create or replace function api.send_message(
  p_conversation_id uuid,
  p_id uuid,
  p_body text default '',
  p_reply_to_id uuid default null,
  p_kind text default 'text',
  p_attachment jsonb default null
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
  v_upload_path text; -- set for photos and documents
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

  -- What is being sent.
  if v_kind = 'text' then
    if char_length(v_body) not between 1 and 4000 then
      raise exception 'Messages are 1 to 4000 characters.' using errcode = '22023';
    end if;
  elsif v_kind in ('image', 'file') then
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
    else
      if char_length(btrim(coalesce(p_attachment ->> 'name', ''))) not between 1 and 200 then
        raise exception 'Documents need a name of up to 200 characters.' using errcode = '22023';
      end if;
      v_attachment := jsonb_build_object(
        'path', v_upload.path, 'size', v_upload.size, 'mime', v_upload.mime,
        'name', btrim(p_attachment ->> 'name'));
    end if;
  elsif v_kind = 'sticker' then
    if coalesce((p_attachment ->> 'pack') ~ '^[a-z0-9_]{1,20}$' and (p_attachment ->> 'id') ~ '^[a-z0-9_]{1,40}$', false) is false then
      raise exception 'Unknown sticker.' using errcode = '22023';
    end if;
    v_body := '';
    v_attachment := jsonb_build_object('pack', p_attachment ->> 'pack', 'id', p_attachment ->> 'id');
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

  -- The actual time of saving (now() is the start of the transaction).
  insert into messaging.messages (id, conversation_id, sender_id, body, reply_to_id, kind, attachment, created_at)
  values (p_id, p_conversation_id, v_uid, v_body, p_reply_to_id, v_kind, v_attachment, clock_timestamp())
  returning created_at into v_created;

  if v_upload_path is not null then
    update messaging.uploads u set message_id = p_id where u.path = v_upload_path;
  end if;

  update messaging.conversations c set
    last_message_id = p_id, last_message_at = v_created,
    last_message_preview = messaging.preview_text(v_kind, v_body, v_attachment), last_sender_id = v_uid
  where c.id = p_conversation_id;

  select p.full_name, p.avatar_path into v_sender from identity.profiles p where p.user_id = v_uid;
  v_payload := jsonb_build_object(
    'id', p_id, 'conversation_id', p_conversation_id, 'kind', v_conversation.kind,
    'sender_id', v_uid, 'sender_name', v_sender.full_name, 'sender_avatar', v_sender.avatar_path,
    'body', v_body, 'reply_to_id', p_reply_to_id, 'created_at', v_created,
    'message_kind', v_kind, 'attachment', v_attachment);

  if v_conversation.kind = 'direct' then
    perform realtime.send(v_payload, 'message', 'user:' || v_uid, true);
    perform realtime.send(v_payload, 'message', 'user:' || v_other, true);
  else
    perform realtime.send(v_payload, 'message', 'chat:' || p_conversation_id, true);
  end if;

  return jsonb_build_object('id', p_id, 'created_at', v_created, 'duplicate', false, 'attachment', v_attachment);
end;
$$;
grant execute on function api.send_message(uuid, uuid, text, uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Reading (adds kind and attachment)
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
  attachment jsonb
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
      case when m.deleted_at is null then m.body end, m.reply_to_id, m.created_at, m.edited_at, m.deleted_at is not null,
      m.kind, case when m.deleted_at is null then m.attachment end
    from messaging.messages m left join identity.profiles p on p.user_id = m.sender_id
    where m.conversation_id = p_conversation_id and m.created_at > p_after
    order by m.created_at asc
    limit v_limit;
  else
    return query
    select m.id, m.sender_id, p.full_name, p.avatar_path,
      case when m.deleted_at is null then m.body end, m.reply_to_id, m.created_at, m.edited_at, m.deleted_at is not null,
      m.kind, case when m.deleted_at is null then m.attachment end
    from messaging.messages m left join identity.profiles p on p.user_id = m.sender_id
    where m.conversation_id = p_conversation_id and (p_before is null or m.created_at < p_before)
    order by m.created_at desc
    limit v_limit;
  end if;
end;
$$;
grant execute on function api.chat_messages(uuid, timestamptz, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Polls
-- ---------------------------------------------------------------------------------------------

-- Votes (or, with an empty list, takes the vote back) and tells everyone looking at the chat.
create or replace function api.vote_poll(p_conversation_id uuid, p_message_id uuid, p_options smallint[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_poll jsonb;
  v_count integer;
  v_options smallint[];
  v_hits integer;
  v_result jsonb;
  v_direct record;
begin
  if v_uid is null or not (select identity.is_active_user()) or not messaging.is_member(p_conversation_id) then
    raise exception 'You are not in this chat.' using errcode = '42501';
  end if;

  select m.attachment into v_poll from messaging.messages m
  where m.id = p_message_id and m.conversation_id = p_conversation_id and m.kind = 'poll' and m.deleted_at is null;
  if v_poll is null then
    raise exception 'That poll is not available.' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(v_poll -> 'options');

  select coalesce(array_agg(distinct o order by o), '{}') into v_options from unnest(coalesce(p_options, '{}')) o;
  if exists (select 1 from unnest(v_options) o where o < 0 or o >= v_count) then
    raise exception 'That option is not in the poll.' using errcode = '22023';
  end if;
  if cardinality(v_options) > 1 and not coalesce((v_poll ->> 'multiple')::boolean, false) then
    raise exception 'This poll takes one answer.' using errcode = '22023';
  end if;

  insert into ops.rate_limits as r (user_id, action, window_start, hits)
  values (v_uid, 'vote_poll', date_trunc('minute', now()), 1)
  on conflict on constraint rate_limits_pkey do update set hits = r.hits + 1
  returning r.hits into v_hits;
  if v_hits > 60 then
    raise exception 'You are voting too quickly. Wait a moment.' using errcode = 'PT429';
  end if;

  if cardinality(v_options) = 0 then
    delete from messaging.poll_votes v where v.message_id = p_message_id and v.user_id = v_uid;
  else
    insert into messaging.poll_votes as v (message_id, conversation_id, user_id, options)
    values (p_message_id, p_conversation_id, v_uid, v_options)
    on conflict (message_id, user_id) do update set options = excluded.options, voted_at = now();
  end if;

  v_result := messaging.poll_counts(p_message_id, v_count)
    || jsonb_build_object('conversation_id', p_conversation_id, 'message_id', p_message_id);

  select * into v_direct from messaging.direct_conversations d where d.conversation_id = p_conversation_id;
  if v_direct.conversation_id is not null then
    perform realtime.send(v_result, 'poll', 'user:' || v_direct.user_low, true);
    perform realtime.send(v_result, 'poll', 'user:' || v_direct.user_high, true);
  else
    perform realtime.send(v_result, 'poll', 'chat:' || p_conversation_id, true);
  end if;

  return v_result || jsonb_build_object('mine', to_jsonb(v_options));
end;
$$;
grant execute on function api.vote_poll(uuid, uuid, smallint[]) to authenticated;

-- Current results for the polls on screen (up to 100 at once), with the caller's own choices.
create or replace function api.poll_results(p_conversation_id uuid, p_message_ids uuid[])
returns table (message_id uuid, counts jsonb, voters integer, mine smallint[])
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not messaging.is_member(p_conversation_id) then
    raise exception 'You are not in this chat.' using errcode = '42501';
  end if;
  return query
  select m.id, r -> 'counts', (r ->> 'voters')::integer,
    coalesce((select v.options from messaging.poll_votes v where v.message_id = m.id and v.user_id = v_uid), '{}')
  from messaging.messages m,
    lateral messaging.poll_counts(m.id, jsonb_array_length(m.attachment -> 'options')) r
  where m.conversation_id = p_conversation_id and m.kind = 'poll' and m.deleted_at is null
    and m.id = any (p_message_ids[1:100]);
end;
$$;
grant execute on function api.poll_results(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Notifications describe photos, documents and the rest
-- ---------------------------------------------------------------------------------------------

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
  v_text := messaging.preview_text(v_message.message_kind, v_message.body, v_message.attachment);

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
      when v_message.kind = 'direct' and v_message.request_status = 'pending' then 'Message request: ' || v_text
      when v_message.kind = 'direct' then v_text
      else split_part(v_message.sender_name, ' ', 1) || ': ' || v_text
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
