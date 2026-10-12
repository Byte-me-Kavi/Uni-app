-- Filing from chats: a folder tag on each file, photo and link in a chat, and choosing a module
-- while sending a document.
--
--   * api.chat_folders tells the chat screen where each of its files, photos and links is filed for
--     this student (module and category), and which were blocked by the file check, so bubbles can
--     show a small folder tag (tap to change it).
--   * api.tag_message lets the sender choose a module while sending. The message id is made on the
--     phone, so the choice is recorded before the upload finishes (content.pending_tags) and applied
--     when the message is saved; if the message is already saved it is applied at once.

create table content.pending_tags (
  message_id uuid primary key,
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  conversation_id uuid not null references messaging.conversations (id) on delete cascade,
  module_id bigint not null references academics.modules (id) on delete cascade,
  category text check (category in
    ('slides', 'notes', 'past_papers', 'tutorials', 'assignments', 'videos', 'links', 'photos', 'other')),
  created_at timestamptz not null default now()
);
create index pending_tags_user_idx on content.pending_tags (user_id, created_at);
create index pending_tags_conversation_idx on content.pending_tags (conversation_id);
create index pending_tags_module_idx on content.pending_tags (module_id);
alter table content.pending_tags enable row level security;
-- No grants: written only by api.tag_message.

-- By id: a trigger on the partitioned messages table sees each row as its monthly partition's type.
create or replace function content.capture_message(p_id uuid, p_created_at timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p_message messaging.messages;
  v_kind text;
  v_title text;
  v_url text;
  v_text text;
  v_conversation record;
  v_module bigint;
  v_study boolean;
  v_category text;
  v_year integer;
  v_tag record;
begin
  select m.* into p_message from messaging.messages m where m.id = p_id and m.created_at = p_created_at;
  if p_message.id is null or p_message.deleted_at is not null or p_message.sender_id is null then
    return;
  end if;
  if p_message.kind = 'file' and p_message.attachment ? 'path' then
    v_kind := 'file';
    v_title := coalesce(nullif(btrim(p_message.attachment ->> 'name'), ''), 'Document');
  elsif p_message.kind = 'image' and p_message.attachment ? 'path' then
    v_kind := 'image';
    v_title := coalesce(nullif(btrim(p_message.body), ''), 'Photo');
  elsif p_message.kind = 'text' and coalesce(p_message.link ->> 'url', '') ~ '^https?://' then
    v_kind := 'link';
    v_url := p_message.link ->> 'url';
    v_title := coalesce(nullif(btrim(p_message.link ->> 'title'), ''), v_url);
  else
    return;
  end if;

  select c.kind, coalesce(c.module_id, s.module_id) as module_id into v_conversation
  from messaging.conversations c
  left join kuppi.sessions s on s.id = c.session_id
  where c.id = p_message.conversation_id;
  v_module := v_conversation.module_id;

  v_text := concat_ws(' ', v_title, p_message.body, p_message.link ->> 'title', p_message.link ->> 'description', v_url);
  v_study := v_kind = 'link' and content.is_study_link(v_url);
  v_category := content.guess_category(v_kind, p_message.attachment ->> 'mime', v_text, v_url);
  if v_category = 'past_papers' then
    v_year := substring(v_text from '(?:^|[^0-9])((?:19|20)[0-9]{2})(?:[^0-9]|$)')::integer;
    if v_year not between 1990 and extract(year from now())::integer + 1 then
      v_year := null;
    end if;
  end if;

  insert into content.chat_items (message_id, conversation_id, sender_id, kind, title, path, mime, size, url, thumb,
    site, category, paper_year, codes, auto, module_id, module_source, created_at)
  values (
    p_message.id, p_message.conversation_id, p_message.sender_id, v_kind, left(v_title, 300),
    case when v_kind <> 'link' then p_message.attachment ->> 'path' end,
    case v_kind when 'file' then p_message.attachment ->> 'mime' when 'image' then 'image/jpeg' end,
    case when v_kind <> 'link' and (p_message.attachment ->> 'size') ~ '^\d{1,9}$' then (p_message.attachment ->> 'size')::integer end,
    v_url,
    case v_kind when 'image' then p_message.attachment ->> 'thumb' when 'link' then left(p_message.link ->> 'image', 1000) end,
    left(p_message.link ->> 'site', 100),
    v_category, v_year, content.module_codes(v_text),
    case v_conversation.kind
      when 'module' then true
      when 'kuppi' then true
      when 'cohort' then v_kind = 'file' or v_study
      when 'group' then v_kind = 'file' or v_study
      when 'direct' then v_kind = 'file'
      else false
    end,
    v_module, case when v_module is not null then 'chat' end,
    p_message.created_at)
  on conflict (message_id) do nothing;

  -- The sender chose a module while sending (api.tag_message, made before the upload finished).
  select pt.module_id, pt.category into v_tag from content.pending_tags pt
  where pt.message_id = p_message.id and pt.user_id = p_message.sender_id and pt.conversation_id = p_message.conversation_id;
  if v_tag.module_id is not null then
    update content.chat_items i set module_id = v_tag.module_id, module_source = 'tag', tagged_by = p_message.sender_id,
      category = coalesce(v_tag.category, i.category)
    where i.message_id = p_message.id;
    delete from content.pending_tags pt where pt.message_id = p_message.id;
  end if;
end;
$$;

-- The sender files a message's document, photo or link for everyone in the chat, even before the
-- message reaches the server (the id is made on the phone).
create or replace function api.tag_message(p_conversation_id uuid, p_message_id uuid, p_module_id bigint, p_category text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_module academics.modules;
  v_item content.chat_items;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if not messaging.is_member(p_conversation_id) then
    raise exception 'You are not in this chat.' using errcode = '42501';
  end if;
  if p_message_id is null or substr(p_message_id::text, 15, 1) <> '7' then
    raise exception 'Messages need a version 7 id.' using errcode = '22023';
  end if;
  if p_category is not null and p_category not in
     ('slides', 'notes', 'past_papers', 'tutorials', 'assignments', 'videos', 'links', 'photos', 'other') then
    raise exception 'Unknown folder.' using errcode = '22023';
  end if;
  v_module := content.my_module(p_module_id);
  perform messaging.hit_limit('tag_item', 200, 'You have filed a lot today. Try again tomorrow.');

  select i.* into v_item from content.chat_items i where i.message_id = p_message_id;
  if v_item.message_id is not null then
    if v_item.conversation_id <> p_conversation_id or v_item.sender_id is distinct from v_uid then
      raise exception 'Only the sender can file this while sending.' using errcode = '42501';
    end if;
    update content.chat_items i set module_id = v_module.id, module_source = 'tag', tagged_by = v_uid,
      category = coalesce(p_category, i.category)
    where i.message_id = p_message_id;
    return;
  end if;

  -- Not saved yet: kept until it is (choices for messages never sent are cleared after a week).
  delete from content.pending_tags pt where pt.user_id = v_uid and pt.created_at < now() - interval '7 days';
  insert into content.pending_tags (message_id, user_id, conversation_id, module_id, category)
  values (p_message_id, v_uid, p_conversation_id, v_module.id, p_category)
  on conflict (message_id) do update set module_id = excluded.module_id, category = excluded.category
  where content.pending_tags.user_id = v_uid;
end;
$$;
grant execute on function api.tag_message(uuid, uuid, bigint, text) to authenticated;

-- Where each of a chat's files, photos and links is filed for the caller: module (code) and
-- category, or blocked by the file check (with the reason). Items not in their library are left out.
create or replace function api.chat_folders(p_conversation_id uuid, p_message_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not (select identity.is_active_user()) or not messaging.is_member(p_conversation_id) then
    raise exception 'You are not in this chat.' using errcode = '42501';
  end if;
  return coalesce((
    with mine as materialized (
      select * from content.my_modules_for(v_uid)
    )
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'message_id', x.message_id,
      'module_id', x.module_id,
      'code', (select m.code from academics.modules m where m.id = x.module_id),
      'category', x.category,
      'blocked', x.blocked,
      'reason', x.reason)))
    from (
      select i.message_id,
        case when i.check_status = 'blocked' then null
             else coalesce(li.module_id, i.module_id, (
               select m.module_id from mine m where i.codes @> array[m.code_key]
               order by m.is_current desc, m.module_id limit 1)) end as module_id,
        coalesce(li.category, i.category) as category,
        i.check_status = 'blocked' as blocked,
        case when i.check_status = 'blocked' then i.check_reason end as reason
      from content.chat_items i
      left join content.library_items li on li.user_id = v_uid and li.message_id = i.message_id
      where i.conversation_id = p_conversation_id
        and i.message_id = any (p_message_ids[1:200])
        and (i.check_status = 'blocked'
             or (i.deleted_at is null and not coalesce(li.hidden, false) and (i.auto or li.message_id is not null)))
    ) x
    where x.blocked or x.module_id is not null), '[]'::jsonb);
end;
$$;
grant execute on function api.chat_folders(uuid, uuid[]) to authenticated;
