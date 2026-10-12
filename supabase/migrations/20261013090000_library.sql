-- Library: documents, photos and links shared in chats, filed into each student's module folders by
-- themselves.
--
-- Recorded once, read per student. When a document, photo or link is sent, a trigger records it
-- once in content.chat_items with what can be guessed from it: a category (lecture slides, past
-- papers, ...), module codes found in its name, caption or link (CS2012), and the chat's module for
-- course and kuppi chats. Nothing is copied or uploaded again, and nothing is written per member:
-- a student's library is worked out when they look, from the chats they are in and their own
-- changes (content.library_items, one row only when they act on an item).
--
-- Which folder, strongest first: the student's own move; a tag by the sender or a rep of the chat;
-- the chat's module; module codes matched against the student's own modules (so a code means the
-- same module for everyone at that university, and new modules pick up older files at once);
-- otherwise "To sort" (the last 60 days).
--
-- What files itself (auto):
--   course and kuppi chats   documents, photos and links
--   batch groups, own groups documents and study links (YouTube, Drive, Docs, OneDrive, GitHub,
--                            university and LMS sites, ...)
--   direct messages          documents
--   national programme groups nothing (too many universities' files): students save what they want
-- Anything else can be saved with one tap. Saving (or moving, pinning) keeps the file for the
-- student even after they leave the chat. Deleting a message for everyone removes it from every
-- library: the sender asked for it to be gone. Delete-for-me hides it from that student only.

-- ---------------------------------------------------------------------------------------------
-- Guessing (pure functions: same text, same answer)
-- ---------------------------------------------------------------------------------------------

-- Module codes in a text, normalised like academics.modules.code_key:
--   'CS2012_Lec03 and ma-1013.pdf' -> {CS2012, MA1013}
create or replace function content.module_codes(p_text text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct upper(m[1] || m[2])), '{}')
  from regexp_matches(coalesce(p_text, ''), '(?:^|[^A-Za-z0-9])([A-Za-z]{2,6})[ _.-]?([0-9]{3,5}[A-Za-z]?)(?![0-9])', 'g') as m;
$$;

-- Links worth filing for study.
create or replace function content.is_study_link(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_url ~* '^https?://([a-z0-9-]+\.)*(youtube\.com|youtu\.be|vimeo\.com|drive\.google\.com|docs\.google\.com|classroom\.google\.com|onedrive\.live\.com|1drv\.ms|sharepoint\.com|dropbox\.com|github\.com|gitlab\.com|notion\.so|notion\.site|coursera\.org|khanacademy\.org|edx\.org|udemy\.com|arxiv\.org|researchgate\.net|ieee\.org|w3schools\.com|geeksforgeeks\.org|stackoverflow\.com|wikipedia\.org|ac\.lk|edu\.lk|edu)(/|:|\?|#|$)'
    or p_url ~* '^https?://[^/]*(moodle|lms|vle)[^/]*(/|$)'
    or p_url ~* '\.(pdf|pptx?|docx?)(\?|#|$)',
    false);
$$;

-- A category from the name, caption and type. Word edges are written out ([^a-z]) because '_' joins
-- words in file names ("CS2012_Lec03").
create or replace function content.guess_category(p_kind text, p_mime text, p_text text, p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind = 'image' then 'photos'
    when coalesce(p_url, '') ~* '^https?://([a-z0-9-]+\.)*(youtube\.com|youtu\.be|vimeo\.com)(/|$)' then 'videos'
    when t ~* '(past[ _-]?papers?|(^|[^a-z])pp([^a-z]|$)|exam|paper[ _-]*(19|20)[0-9]{2}|(19|20)[0-9]{2}[ _-]*paper|model[ _-]?paper|mid[ _-]?(sem|term)|end[ _-]?sem|final[ _-]?paper|answer[ _-]?script|marking[ _-]?scheme)'
      then 'past_papers'
    when t ~* '(tutorial|(^|[^a-z])tute|(^|[^a-z])labs?([^a-z]|$)|lab[ _-]?sheet|worksheet|practical|problem[ _-]?sets?|exercises?([^a-z]|$))'
      then 'tutorials'
    when t ~* '(assignment|course[ _-]?work|project[ _-]?(brief|spec)|take[ _-]?home)'
      then 'assignments'
    when t ~* '(lecture|(^|[^a-z])lec|(^|[^a-z])slides?([^a-z]|$))'
      or coalesce(p_mime, '') in ('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint')
      then 'slides'
    when t ~* '((^|[^a-z])notes?([^a-z]|$)|summary|short[ _-]?notes?|cheat[ _-]?sheet|handout)'
      then 'notes'
    -- Weaker signs of lecture material, after notes: "Week 2 notes" is notes.
    when t ~* '((^|[^a-z])week[ _-]?[0-9]|lesson|chapter|(^|[^a-z])ch[ _-]?[0-9])'
      then 'slides'
    when p_kind = 'link' then 'links'
    else 'other'
  end
  from (select coalesce(p_text, '') as t) x;
$$;

grant execute on function content.module_codes(text) to authenticated, service_role;
grant execute on function content.is_study_link(text) to authenticated, service_role;
grant execute on function content.guess_category(text, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table content.chat_items (
  -- One item per message. No foreign key: messages are partitioned by month.
  message_id uuid primary key,
  conversation_id uuid not null references messaging.conversations (id) on delete cascade,
  sender_id uuid references identity.profiles (user_id) on delete set null,
  kind text not null check (kind in ('file', 'image', 'link')),
  title text not null check (char_length(title) between 1 and 300),
  path text check (char_length(path) <= 300),
  mime text check (char_length(mime) <= 150),
  size integer check (size >= 0),
  url text check (char_length(url) <= 2000),
  -- Photos: a tiny blurred preview (data URI). Links: the preview image's address.
  thumb text check (char_length(thumb) <= 4000),
  site text check (char_length(site) <= 100),
  category text not null check (category in
    ('slides', 'notes', 'past_papers', 'tutorials', 'assignments', 'videos', 'links', 'photos', 'other')),
  paper_year smallint check (paper_year between 1990 and 2100),
  codes text[] not null default '{}',
  auto boolean not null,
  -- The chat's module (course and kuppi chats), or a tag by the sender or a rep.
  module_id bigint references academics.modules (id) on delete set null,
  module_source text check (module_source in ('chat', 'tag')),
  tagged_by uuid references identity.profiles (user_id) on delete set null,
  created_at timestamptz not null,
  deleted_at timestamptz,
  constraint chat_items_has_target check (path is not null or url is not null),
  constraint chat_items_module_source check ((module_id is null) = (module_source is null))
);
-- A student's items: per chat, newest first.
create index chat_items_conversation_idx on content.chat_items (conversation_id, created_at desc);
create index chat_items_module_idx on content.chat_items (module_id);
create index chat_items_codes_idx on content.chat_items using gin (codes);
create index chat_items_path_idx on content.chat_items (path) where path is not null;
create index chat_items_sender_idx on content.chat_items (sender_id);
create index chat_items_tagged_by_idx on content.chat_items (tagged_by);

-- A student's own changes to an item. Written only when they act on it.
create table content.library_items (
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  message_id uuid not null references content.chat_items (message_id) on delete cascade,
  module_id bigint references academics.modules (id) on delete set null,
  category text check (category in
    ('slides', 'notes', 'past_papers', 'tutorials', 'assignments', 'videos', 'links', 'photos', 'other')),
  -- Kept for the student even after they leave the chat.
  saved boolean not null default true,
  hidden boolean not null default false,
  pinned_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
create index library_items_message_idx on content.library_items (message_id);
create index library_items_user_module_idx on content.library_items (user_id, module_id);
create index library_items_module_idx on content.library_items (module_id);

alter table content.chat_items enable row level security;
alter table content.library_items enable row level security;
-- No grants and no policies: read and written only through the api functions below.

-- ---------------------------------------------------------------------------------------------
-- Recording items as messages are sent (and forgetting them when deleted for everyone)
-- ---------------------------------------------------------------------------------------------

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
end;
$$;
revoke execute on function content.capture_message(uuid, timestamptz) from public, anon, authenticated;

create or replace function content.capture_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind in ('file', 'image') or new.link is not null then
    perform content.capture_message(new.id, new.created_at);
  end if;
  return null;
end;
$$;
revoke execute on function content.capture_trigger() from public, anon, authenticated;
create trigger messages_capture_items after insert on messaging.messages
  for each row execute function content.capture_trigger();

create or replace function content.forget_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update content.chat_items i set deleted_at = new.deleted_at where i.message_id = new.id;
  return null;
end;
$$;
revoke execute on function content.forget_trigger() from public, anon, authenticated;
create trigger messages_forget_items after update of deleted_at on messaging.messages
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function content.forget_trigger();

-- Files and links already shared.
select content.capture_message(m.id, m.created_at) from messaging.messages m
where (m.kind in ('file', 'image') or m.link is not null) and m.deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Reading helpers (internal)
-- ---------------------------------------------------------------------------------------------

-- The modules a student's files can be filed into: every module they take or took in their batch,
-- modules they repeat, and modules they added that wait for batchmates. is_current: this semester.
create or replace function content.my_modules_for(p_uid uuid)
returns table (module_id bigint, code_key text, name text, is_current boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select m.cohort_id, co.current_year, co.current_semester
    from academics.cohort_members m join academics.cohorts co on co.id = m.cohort_id
    where m.user_id = p_uid
  ), ids as (
    select t.module_id, false as cur from c, academics.taken_modules(c.cohort_id, p_uid) t
    union all
    select w.module_id, true from c, academics.current_modules(c.cohort_id, p_uid) w
    union all
    select ch.module_id, true from academics.module_choices ch where ch.user_id = p_uid and ch.choice = 'repeat'
    union all
    select v.module_id, coalesce((v.year_of_study, v.semester) = (c.current_year, c.current_semester), true)
    from c join academics.cohort_module_votes v on v.cohort_id = c.cohort_id and v.user_id = p_uid
  )
  select mo.id, mo.code_key, mo.name, bool_or(ids.cur)
  from ids join academics.modules mo on mo.id = ids.module_id
  group by mo.id, mo.code_key, mo.name;
$$;
revoke execute on function content.my_modules_for(uuid) from public, anon, authenticated;

-- What the app shows for an item.
create or replace function content.item_json(i content.chat_items, li content.library_items)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', i.message_id,
    'conversation_id', i.conversation_id,
    'chat_kind', c.kind,
    'chat_title', c.title,
    'sender_name', p.full_name,
    'kind', i.kind,
    'title', i.title,
    'path', i.path,
    'mime', i.mime,
    'size', i.size,
    'url', i.url,
    'thumb', i.thumb,
    'site', i.site,
    'category', coalesce(li.category, i.category),
    'paper_year', i.paper_year,
    'created_at', i.created_at,
    'pinned', li.pinned_at is not null,
    'module_id', coalesce(li.module_id, i.module_id)))
  from messaging.conversations c
  left join identity.profiles p on p.user_id = i.sender_id
  where c.id = i.conversation_id;
$$;
revoke execute on function content.item_json(content.chat_items, content.library_items) from public, anon, authenticated;

-- Everything in one student's library, before deciding folders: items from their chats that file
-- themselves or that they acted on, and anything they saved from a chat they have since left.
-- Never: items deleted for everyone, hidden by them, deleted for them, or from students they block.
create or replace function content.my_items(p_uid uuid)
returns table (message_id uuid, k text, created_at timestamptz, module_id bigint, codes text[], my_module bigint, title text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.message_id, coalesce(i.path, i.url), i.created_at, i.module_id, i.codes, li.module_id, i.title
  from content.chat_items i
  left join content.library_items li on li.user_id = p_uid and li.message_id = i.message_id
  where i.conversation_id in (select cm.conversation_id from messaging.conversation_members cm where cm.user_id = p_uid)
    and i.deleted_at is null
    and (i.auto or li.message_id is not null)
    and not coalesce(li.hidden, false)
    and not exists (select 1 from messaging.hidden_messages h where h.user_id = p_uid and h.message_id = i.message_id)
    and not exists (select 1 from safety.blocks b where b.blocker_id = p_uid and b.blocked_id = i.sender_id)
  union
  select i.message_id, coalesce(i.path, i.url), i.created_at, i.module_id, i.codes, li.module_id, i.title
  from content.library_items li
  join content.chat_items i on i.message_id = li.message_id
  where li.user_id = p_uid and li.saved and not li.hidden and i.deleted_at is null
    and not exists (select 1 from messaging.hidden_messages h where h.user_id = p_uid and h.message_id = i.message_id)
    and not exists (select 1 from safety.blocks b where b.blocker_id = p_uid and b.blocked_id = i.sender_id);
$$;
revoke execute on function content.my_items(uuid) from public, anon, authenticated;

-- One module's folder for one student. Reads only that module's candidates (by chat module, tag,
-- code or the student's own moves), so opening a folder stays cheap however many files a student's
-- chats hold. The same file forwarded to several chats shows once.
create or replace function content.module_items(p_uid uuid, p_module_id bigint, p_key text)
returns table (message_id uuid, category text, created_at timestamptz, pinned_at timestamptz, item jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as (
    select i.message_id from content.chat_items i
    where i.conversation_id in (select cm.conversation_id from messaging.conversation_members cm where cm.user_id = p_uid)
      and i.deleted_at is null
      and (i.module_id = p_module_id or (i.module_id is null and i.codes @> array[p_key]))
    union
    -- The student's own moves, and items they saved (still here after they leave the chat).
    select li.message_id from content.library_items li
    join content.chat_items i on i.message_id = li.message_id
    where li.user_id = p_uid and i.deleted_at is null
      and (li.module_id = p_module_id
           or (li.module_id is null and li.saved
               and (i.module_id = p_module_id or (i.module_id is null and i.codes @> array[p_key]))))
  )
  select v.message_id, v.category, v.created_at, v.pinned_at, v.item
  from (
    select distinct on (coalesce(i.path, i.url))
      i.message_id, coalesce(li.category, i.category) as category, i.created_at, li.pinned_at,
      content.item_json(i, li) as item
    from candidates c
    join content.chat_items i on i.message_id = c.message_id
    left join content.library_items li on li.user_id = p_uid and li.message_id = i.message_id
    where i.deleted_at is null
      and (li.saved or exists (select 1 from messaging.conversation_members cm
                               where cm.conversation_id = i.conversation_id and cm.user_id = p_uid))
      and (i.auto or li.message_id is not null)
      and not coalesce(li.hidden, false)
      and (li.module_id is null or li.module_id = p_module_id)
      and not exists (select 1 from messaging.hidden_messages h where h.user_id = p_uid and h.message_id = i.message_id)
      and not exists (select 1 from safety.blocks b where b.blocker_id = p_uid and b.blocked_id = i.sender_id)
    order by coalesce(i.path, i.url), (li.message_id is not null) desc, i.created_at desc
  ) v;
$$;
revoke execute on function content.module_items(uuid, bigint, text) from public, anon, authenticated;

-- A module at the caller's university (following merges), or an error.
create or replace function content.my_module(p_module_id bigint)
returns academics.modules
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_module academics.modules;
begin
  select m.* into v_module from academics.modules m
  where m.id = (select coalesce(x.merged_into_id, x.id) from academics.modules x where x.id = p_module_id)
    and m.institution_id = (select identity.current_institution_id());
  if v_module.id is null then
    raise exception 'That module is not at your university.' using errcode = '22023';
  end if;
  return v_module;
end;
$$;
revoke execute on function content.my_module(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- api: reading
-- ---------------------------------------------------------------------------------------------

-- For the Resources tab: how many files each of the student's modules holds (and how many arrived
-- this week), and how many are waiting in To sort.
create or replace function api.library_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  with mine as materialized (
    select * from content.my_modules_for(v_uid)
  ), items as materialized (
    select * from content.my_items(v_uid)
  ), placed as (
    select it.message_id, it.k, it.created_at, m.module_id
    from items it
    join mine m on m.module_id = coalesce(it.my_module, it.module_id)
      or (it.my_module is null and it.module_id is null and it.codes @> array[m.code_key])
  )
  select jsonb_build_object(
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object('module_id', p.module_id, 'count', p.n, 'new', p.fresh))
      from (
        select pl.module_id, count(distinct pl.k) as n,
          count(distinct pl.k) filter (where pl.created_at > now() - interval '7 days') as fresh
        from placed pl group by pl.module_id
      ) p), '[]'::jsonb),
    'to_sort', (
      select count(distinct it.k) from items it
      where it.my_module is null and it.module_id is null and it.created_at > now() - interval '60 days'
        and not exists (select 1 from placed pl where pl.message_id = it.message_id))
  ) into v_result;
  return v_result;
end;
$$;
grant execute on function api.library_overview() to authenticated;

-- One module's folder: counts per category and pinned items (first page), then items newest first.
create or replace function api.library(
  p_module_id bigint,
  p_category text default null,
  p_before timestamptz default null,
  p_limit integer default 40
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_module academics.modules;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v_module := content.my_module(p_module_id);

  return (
    with all_items as materialized (
      select * from content.module_items(v_uid, v_module.id, v_module.code_key)
    )
    select jsonb_build_object(
      'module', jsonb_build_object('id', v_module.id, 'code', v_module.code, 'name', v_module.name),
      'folders', case when p_before is null then coalesce((
        select jsonb_agg(jsonb_build_object('category', f.category, 'count', f.n) order by f.n desc)
        from (select a.category, count(*) as n from all_items a group by a.category) f), '[]'::jsonb) end,
      'pinned', case when p_before is null and p_category is null then coalesce((
        select jsonb_agg(a.item order by a.pinned_at desc) from all_items a where a.pinned_at is not null), '[]'::jsonb) end,
      'items', coalesce((
        select jsonb_agg(x.item order by x.created_at desc)
        from (
          select a.item, a.created_at from all_items a
          where (p_category is null or a.category = p_category)
            and (p_before is null or a.created_at < p_before)
          order by a.created_at desc
          limit least(greatest(coalesce(p_limit, 40), 1), 100)
        ) x), '[]'::jsonb)
    )
  );
end;
$$;
grant execute on function api.library(bigint, text, timestamptz, integer) to authenticated;

-- To sort: the last 60 days' items that matched none of the student's modules, newest first, each
-- with a suggested module (this semester's module whose name is closest to the item's name).
create or replace function api.library_to_sort(p_before timestamptz default null, p_limit integer default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  return (
    with mine as materialized (
      select * from content.my_modules_for(v_uid)
    ), items as materialized (
      select * from content.my_items(v_uid)
    ), waiting as (
      select distinct on (it.k) it.message_id, it.created_at, it.title
      from items it
      where it.my_module is null and it.module_id is null and it.created_at > now() - interval '60 days'
        and (p_before is null or it.created_at < p_before)
        and not exists (select 1 from mine m where it.codes @> array[m.code_key])
      order by it.k, it.created_at desc
    )
    select coalesce(jsonb_agg(x.item order by x.created_at desc), '[]'::jsonb)
    from (
      select content.item_json(i, li) || jsonb_build_object('suggested_module_id', (
               select m.module_id from mine m
               where m.is_current and extensions.similarity(lower(w.title), lower(m.name)) > 0.2
               order by extensions.similarity(lower(w.title), lower(m.name)) desc limit 1)) as item,
             w.created_at
      from waiting w
      join content.chat_items i on i.message_id = w.message_id
      left join content.library_items li on li.user_id = v_uid and li.message_id = w.message_id
      order by w.created_at desc
      limit least(greatest(coalesce(p_limit, 40), 1), 100)
    ) x
  );
end;
$$;
grant execute on function api.library_to_sort(timestamptz, integer) to authenticated;

-- One message's item as the student sees it (for "Save to Resources" in a chat): its category and
-- the module it is filed in for them, if any. Null when the message holds no file or link.
create or replace function api.library_item(p_message_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_item content.chat_items;
  v_mine content.library_items;
  v_module bigint;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select i.* into v_item from content.chat_items i where i.message_id = p_message_id and i.deleted_at is null;
  select li.* into v_mine from content.library_items li where li.user_id = v_uid and li.message_id = p_message_id;
  if v_item.message_id is null or not (messaging.is_member(v_item.conversation_id) or coalesce(v_mine.saved, false)) then
    return null;
  end if;
  v_module := coalesce(v_mine.module_id, v_item.module_id, (
    select m.module_id from content.my_modules_for(v_uid) m
    where v_item.codes @> array[m.code_key] order by m.is_current desc, m.module_id limit 1));
  return content.item_json(v_item, v_mine) || jsonb_build_object(
    'module_id', v_module,
    'in_library', not coalesce(v_mine.hidden, false) and (v_item.auto or v_mine.message_id is not null),
    'saved', coalesce(v_mine.saved, false));
end;
$$;
grant execute on function api.library_item(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- api: changing
-- ---------------------------------------------------------------------------------------------

-- The student files an item for themselves: into a module, a category, pinned or not, or hidden
-- from their library. Null leaves that part as it is. Acting on an item saves it: it stays in the
-- student's library even after they leave the chat.
create or replace function api.organise_item(
  p_message_id uuid,
  p_module_id bigint default null,
  p_category text default null,
  p_pinned boolean default null,
  p_hidden boolean default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_item content.chat_items;
  v_module academics.modules;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select i.* into v_item from content.chat_items i where i.message_id = p_message_id and i.deleted_at is null;
  if v_item.message_id is null or not (
    messaging.is_member(v_item.conversation_id)
    or exists (select 1 from content.library_items li where li.user_id = v_uid and li.message_id = p_message_id and li.saved)
  ) then
    raise exception 'That file is not available.' using errcode = '22023';
  end if;
  if p_module_id is not null then
    v_module := content.my_module(p_module_id);
  end if;
  if p_category is not null and p_category not in
     ('slides', 'notes', 'past_papers', 'tutorials', 'assignments', 'videos', 'links', 'photos', 'other') then
    raise exception 'Unknown folder.' using errcode = '22023';
  end if;
  perform messaging.hit_limit('library', 500, 'You have organised a lot today. Try again tomorrow.');

  insert into content.library_items as li (user_id, message_id, module_id, category, saved, hidden, pinned_at)
  values (v_uid, p_message_id, v_module.id, p_category, true, coalesce(p_hidden, false),
          case when p_pinned and not coalesce(p_hidden, false) then now() end)
  on conflict (user_id, message_id) do update set
    module_id = coalesce(excluded.module_id, li.module_id),
    category = coalesce(excluded.category, li.category),
    hidden = coalesce(p_hidden, li.hidden),
    pinned_at = case
      when p_hidden then null
      when p_pinned is null then li.pinned_at
      when p_pinned then coalesce(li.pinned_at, now())
    end,
    saved = true,
    updated_at = now();
  return api.library_item(p_message_id);
end;
$$;
grant execute on function api.organise_item(uuid, bigint, text, boolean, boolean) to authenticated;

-- The sender of a file or link, or a rep or admin of the chat, tags it with a module (and
-- category) for everyone in the chat at that university. A null module clears the tag. Students'
-- own moves still win for themselves.
create or replace function api.tag_item(p_message_id uuid, p_module_id bigint, p_category text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_item content.chat_items;
  v_module academics.modules;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select i.* into v_item from content.chat_items i where i.message_id = p_message_id and i.deleted_at is null;
  if v_item.message_id is null or not messaging.is_member(v_item.conversation_id) then
    raise exception 'That file is not available.' using errcode = '22023';
  end if;
  if v_item.sender_id is distinct from v_uid and not exists (
    select 1 from messaging.conversation_members m
    where m.conversation_id = v_item.conversation_id and m.user_id = v_uid and m.role = 'admin'
  ) then
    raise exception 'Only the sender or a rep can file this for everyone.' using errcode = '42501';
  end if;
  if p_module_id is not null then
    v_module := content.my_module(p_module_id);
  end if;
  if p_category is not null and p_category not in
     ('slides', 'notes', 'past_papers', 'tutorials', 'assignments', 'videos', 'links', 'photos', 'other') then
    raise exception 'Unknown folder.' using errcode = '22023';
  end if;
  perform messaging.hit_limit('tag_item', 200, 'You have filed a lot today. Try again tomorrow.');

  update content.chat_items i set
    module_id = case when v_module.id is not null then v_module.id when i.module_source = 'tag' then null else i.module_id end,
    module_source = case when v_module.id is not null then 'tag' when i.module_source = 'tag' then null else i.module_source end,
    tagged_by = v_uid,
    category = coalesce(p_category, i.category)
  where i.message_id = p_message_id;
end;
$$;
grant execute on function api.tag_item(uuid, bigint, text) to authenticated;

-- Private files can now also be read by students who saved them (and still have them in their
-- library), even after leaving the chat. Unchanged otherwise.
create or replace function api.media_access(p_paths text[])
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select r.path from messaging.media_refs r
  join messaging.conversation_members m on m.conversation_id = r.conversation_id and m.user_id = (select auth.uid())
  where r.path = any (p_paths[1:100]) and (select identity.is_active_user())
  union
  select i.path from content.chat_items i
  join content.library_items li on li.message_id = i.message_id and li.user_id = (select auth.uid())
  where i.path = any (p_paths[1:100]) and li.saved and not li.hidden and i.deleted_at is null
    and (select identity.is_active_user());
$$;
