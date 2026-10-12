-- Shared files, second round: duplicates, search inside files, the national subject index, and
-- past-paper discussions.
--
-- Duplicates. The files function fingerprints every file it checks (SHA-256 of the bytes). The same
-- PDF posted by five people (each re-downloaded, so stored five times) shows once in a library, and a
-- file already shared at the university is not shared again ("Already shared as ... in CS2012").
--
-- Search inside files. After a file passes its check, the files function extracts its text (PDF,
-- Word, PowerPoint, plain text) into content.file_text, once per fingerprint. Library and Explore
-- search match the text too ("Dijkstra" finds Lecture 7) and show the matching line.
--
-- National subject index. Each module links to a national subject (academics.subjects), matched
-- from its name when the module is created ("Data Structures and Algorithms II" and "Data Structures
-- and Algorithms" share one subject; near-identical names are merged automatically). Reps and
-- moderators can correct a module's subject. Files stay visible to the uploader's university only,
-- unless the uploader chose "All universities" when sharing (scope 'national'): only those appear to
-- students at other universities taking a module of the same subject.
--
-- Past-paper discussions. A thread on every shared file, optionally per question ("Q3(b)"): answers,
-- one level of replies, helpful votes (best answers first). Names are shown (accountability);
-- students blocked either way are hidden; every comment can be reported; authors and moderators can
-- delete.

-- ---------------------------------------------------------------------------------------------
-- Fingerprints and text
-- ---------------------------------------------------------------------------------------------

alter table content.chat_items add column sha256 text check (sha256 ~ '^[0-9a-f]{64}$');
create index chat_items_sha256_idx on content.chat_items (sha256) where sha256 is not null;

alter table content.resources
  add column sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  add column scope text not null default 'university' check (scope in ('university', 'national')),
  add column comment_count integer not null default 0 check (comment_count >= 0);
create index resources_institution_sha256_idx on content.resources (institution_id, sha256) where status = 'live' and deleted_at is null;
create index resources_national_idx on content.resources (created_at desc) where scope = 'national' and status = 'live' and deleted_at is null;

do $$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
    where conrelid = 'content.resources'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table content.resources drop constraint %I', v_name);
  end loop;
end $$;
alter table content.resources add constraint resources_status_check
  check (status in ('pending', 'live', 'quarantined', 'duplicate', 'removed'));

create table content.file_text (
  sha256 text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
  body text not null check (char_length(body) <= 200000),
  search tsvector generated always as (to_tsvector('simple', body)) stored,
  created_at timestamptz not null default now()
);
create index file_text_search_idx on content.file_text using gin (search);
alter table content.file_text enable row level security;
-- No grants: read through the search functions below, written by the files function.

-- The files function's verdict on a chat file, now with its fingerprint (service role only).
drop function api.chat_file_checked(uuid, boolean, text);
create or replace function api.chat_file_checked(p_message_id uuid, p_ok boolean, p_reason text default null, p_sha256 text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item content.chat_items;
begin
  select i.* into v_item from content.chat_items i where i.message_id = p_message_id;
  if v_item.message_id is null then
    return;
  end if;
  if p_ok then
    update content.chat_items i set check_status = 'clean', check_reason = null,
      sha256 = case when p_sha256 ~ '^[0-9a-f]{64}$' then p_sha256 end
    where i.message_id = p_message_id;
    return;
  end if;
  update content.chat_items i set check_status = 'blocked', check_reason = left(p_reason, 200),
    deleted_at = coalesce(i.deleted_at, now())
  where i.message_id = p_message_id;
  update messaging.messages m set attachment = m.attachment || jsonb_build_object('blocked', true, 'blocked_reason', left(p_reason, 200))
  where m.id = p_message_id and m.created_at = v_item.created_at;
  update content.resources r set status = 'removed', deleted_at = coalesce(r.deleted_at, now())
  where r.source_message_id = p_message_id;
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (null, 'files.blocked', 'content.chat_items', p_message_id::text,
          jsonb_build_object('path', v_item.path, 'reason', p_reason, 'sender_id', v_item.sender_id));
end;
$$;
revoke execute on function api.chat_file_checked(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function api.chat_file_checked(uuid, boolean, text, text) to service_role;

-- The files function's verdict on a shared file. A file already live at the university (same
-- fingerprint) is marked a duplicate instead, with the one to use.
drop function api.finish_resource(uuid, boolean, text, integer);
create or replace function api.finish_resource(
  p_resource_id uuid,
  p_ok boolean,
  p_reason text default null,
  p_size integer default null,
  p_sha256 text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_resource content.resources;
  v_existing_id uuid;
  v_existing_title text;
  v_existing_code text;
  v_sha text := case when p_sha256 ~ '^[0-9a-f]{64}$' then p_sha256 end;
  v_status text;
  v_reason text;
begin
  select r.* into v_resource from content.resources r where r.id = p_resource_id and r.status = 'pending';
  if v_resource.id is null then
    return jsonb_build_object('status', null);
  end if;
  if p_ok and v_sha is not null then
    select r.id, r.title, m.code into v_existing_id, v_existing_title, v_existing_code
    from content.resources r join academics.modules m on m.id = r.module_id
    where r.institution_id = v_resource.institution_id and r.sha256 = v_sha and r.status = 'live'
      and r.deleted_at is null and r.id <> p_resource_id
    limit 1;
  end if;
  v_status := case when not p_ok then 'quarantined' when v_existing_id is not null then 'duplicate' else 'live' end;
  v_reason := case
    when not p_ok then left(p_reason, 200)
    when v_existing_id is not null then left('Already shared as “' || v_existing_title || '” in ' || v_existing_code || '.', 200)
  end;
  update content.resources r set status = v_status, check_reason = v_reason, sha256 = v_sha,
    size_bytes = coalesce(p_size, r.size_bytes), checked_at = now()
  where r.id = p_resource_id;
  if not p_ok then
    insert into ops.audit_log (actor_id, action, target_table, target_id, details)
    values (null, 'files.quarantined', 'content.resources', p_resource_id::text,
            jsonb_build_object('reason', p_reason, 'uploader_id', v_resource.uploader_id));
  end if;
  return jsonb_build_object('status', v_status, 'reason', v_reason, 'existing_id', v_existing_id);
end;
$$;
revoke execute on function api.finish_resource(uuid, boolean, text, integer, text) from public, anon, authenticated;
grant execute on function api.finish_resource(uuid, boolean, text, integer, text) to service_role;

-- Text extracted by the files function, once per fingerprint (service role only).
create or replace function api.needs_text(p_sha256 text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from content.file_text f where f.sha256 = p_sha256);
$$;
revoke execute on function api.needs_text(text) from public, anon, authenticated;
grant execute on function api.needs_text(text) to service_role;

create or replace function api.store_file_text(p_sha256 text, p_text text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into content.file_text (sha256, body)
  select p_sha256, left(btrim(p_text), 200000)
  where p_sha256 ~ '^[0-9a-f]{64}$' and char_length(btrim(coalesce(p_text, ''))) > 0
  on conflict (sha256) do nothing;
$$;
revoke execute on function api.store_file_text(text, text) from public, anon, authenticated;
grant execute on function api.store_file_text(text, text) to service_role;

-- A line of the file around the words searched for (for search results).
create or replace function content.snippet(p_sha256 text, p_query tsquery)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ts_headline('simple', left(f.body, 50000), p_query,
                     'MaxWords=18, MinWords=6, MaxFragments=1, StartSel=«, StopSel=», ShortWord=2')
  from content.file_text f where f.sha256 = p_sha256 and f.search @@ p_query;
$$;
revoke execute on function content.snippet(text, tsquery) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Library: one item per file content, and search inside files
-- ---------------------------------------------------------------------------------------------

create or replace function content.my_items(p_uid uuid)
returns table (message_id uuid, k text, created_at timestamptz, module_id bigint, codes text[], my_module bigint, title text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.message_id, coalesce(i.sha256, i.path, i.url), i.created_at, i.module_id, i.codes, li.module_id, i.title
  from content.chat_items i
  left join content.library_items li on li.user_id = p_uid and li.message_id = i.message_id
  where i.conversation_id in (select cm.conversation_id from messaging.conversation_members cm where cm.user_id = p_uid)
    and i.deleted_at is null
    and (i.auto or li.message_id is not null)
    and not coalesce(li.hidden, false)
    and not exists (select 1 from messaging.hidden_messages h where h.user_id = p_uid and h.message_id = i.message_id)
    and not exists (select 1 from safety.blocks b where b.blocker_id = p_uid and b.blocked_id = i.sender_id)
  union
  select i.message_id, coalesce(i.sha256, i.path, i.url), i.created_at, i.module_id, i.codes, li.module_id, i.title
  from content.library_items li
  join content.chat_items i on i.message_id = li.message_id
  where li.user_id = p_uid and li.saved and not li.hidden and i.deleted_at is null
    and not exists (select 1 from messaging.hidden_messages h where h.user_id = p_uid and h.message_id = i.message_id)
    and not exists (select 1 from safety.blocks b where b.blocker_id = p_uid and b.blocked_id = i.sender_id);
$$;

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
    select li.message_id from content.library_items li
    join content.chat_items i on i.message_id = li.message_id
    where li.user_id = p_uid and i.deleted_at is null
      and (li.module_id = p_module_id
           or (li.module_id is null and li.saved
               and (i.module_id = p_module_id or (i.module_id is null and i.codes @> array[p_key]))))
  )
  select v.message_id, v.category, v.created_at, v.pinned_at, v.item
  from (
    -- The same content (fingerprint), or the same file or link, shows once: the copy the student
    -- acted on, else the newest.
    select distinct on (coalesce(i.sha256, i.path, i.url))
      i.message_id, coalesce(li.category, i.category) as category, i.created_at, li.pinned_at,
      content.item_json(i, li) || jsonb_build_object(
        'can_share', i.kind in ('file', 'image')
          and content.resource_ext(i.mime) is not null
          and (i.sender_id = p_uid or exists (
            select 1 from messaging.conversation_members cm join messaging.conversations c on c.id = cm.conversation_id
            where cm.conversation_id = i.conversation_id and cm.user_id = p_uid and cm.role = 'admin' and c.kind = 'cohort'))
          and not exists (select 1 from content.resources r where r.source_message_id = i.message_id and r.deleted_at is null)) as item
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
    order by coalesce(i.sha256, i.path, i.url), (li.message_id is not null) desc, i.created_at desc
  ) v;
$$;

-- Search across the student's own library: names, module codes, and the text inside files (with the
-- matching line).
create or replace function api.library_search(p_query text, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_query text := btrim(coalesce(p_query, ''));
  v_like text;
  v_ts tsquery;
  v_code text := upper(regexp_replace(coalesce(p_query, ''), '[^[:alnum:]]+', '', 'g'));
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if char_length(v_query) < 2 then
    return '[]'::jsonb;
  end if;
  v_like := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_ts := plainto_tsquery('simple', v_query);
  return coalesce((
    select jsonb_agg(content.item_json(i, li) || jsonb_strip_nulls(jsonb_build_object('snippet', hit.snippet)) order by hit.created_at desc)
    from (
      select h.message_id, h.created_at,
        case when not h.title_hit then content.snippet(h.sha256, v_ts) end as snippet
      from (
        select distinct on (it.k) it.message_id, it.created_at, i2.sha256,
          (it.title ilike v_like or extensions.word_similarity(v_query, it.title) > 0.5 or it.codes @> array[v_code]) as title_hit
        from content.my_items(v_uid) it
        join content.chat_items i2 on i2.message_id = it.message_id
        where it.title ilike v_like or extensions.word_similarity(v_query, it.title) > 0.5 or it.codes @> array[v_code]
           or exists (select 1 from content.file_text f where f.sha256 = i2.sha256 and f.search @@ v_ts)
        order by it.k, it.created_at desc
      ) h
      order by h.created_at desc
      limit least(greatest(coalesce(p_limit, 30), 1), 60)
    ) hit
    join content.chat_items i on i.message_id = hit.message_id
    left join content.library_items li on li.user_id = v_uid and li.message_id = hit.message_id), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- National subject index
-- ---------------------------------------------------------------------------------------------

alter table academics.subjects
  add column name_key text generated always as (lower(regexp_replace(name, '[^[:alnum:]]+', '', 'g'))) stored,
  add column merged_into_id bigint references academics.subjects (id) on delete set null,
  add column created_at timestamptz not null default now();
alter table academics.subjects add constraint subjects_name_key_unique unique (name_key);
create index subjects_merged_into_idx on academics.subjects (merged_into_id);
create index subjects_name_trgm_idx on academics.subjects using gin (name extensions.gin_trgm_ops);

-- The subject a module name describes: levels and notes in brackets dropped.
--   "Data Structures and Algorithms II" -> "Data Structures and Algorithms"; "Calculus I" -> "Calculus"
create or replace function academics.subject_name(p_module_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(btrim(regexp_replace(coalesce(p_module_name, ''), '\s+', ' ', 'g')), '\s*\([^)]*\)\s*$', ''),
    '\s+(I{1,3}|IV|[1-4])$', '', 'i'));
$$;

-- Links a module to its subject (same name, else a near-identical one, else a new subject).
create or replace function academics.ensure_subject(p_module_id bigint)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_key text;
  v_subject bigint;
begin
  select academics.subject_name(m.name) into v_name from academics.modules m where m.id = p_module_id;
  if char_length(coalesce(v_name, '')) < 2 then
    return null;
  end if;
  v_key := lower(regexp_replace(v_name, '[^[:alnum:]]+', '', 'g'));
  select coalesce(s.merged_into_id, s.id) into v_subject from academics.subjects s where s.name_key = v_key;
  if v_subject is null then
    select s.id into v_subject from academics.subjects s
    where s.merged_into_id is null and extensions.similarity(s.name, v_name) >= 0.6
    order by extensions.similarity(s.name, v_name) desc limit 1;
  end if;
  if v_subject is null then
    insert into academics.subjects (name) values (left(v_name, 120)) on conflict do nothing;
    select coalesce(s.merged_into_id, s.id) into v_subject from academics.subjects s where s.name_key = v_key;
  end if;
  update academics.modules m set subject_id = v_subject where m.id = p_module_id;
  return v_subject;
end;
$$;
revoke execute on function academics.ensure_subject(bigint) from public, anon, authenticated;

create or replace function academics.module_subject_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.subject_id is null then
    perform academics.ensure_subject(new.id);
  end if;
  return null;
end;
$$;
revoke execute on function academics.module_subject_trigger() from public, anon, authenticated;
create trigger modules_subject after insert on academics.modules
  for each row execute function academics.module_subject_trigger();

select academics.ensure_subject(m.id) from academics.modules m where m.subject_id is null;

-- A module's subject, and how far it reaches: universities teaching it, and files shared nationally.
create or replace function api.module_subject(p_module_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_module academics.modules;
  v_subject bigint;
begin
  if not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v_module := content.my_module(p_module_id);
  select coalesce(s.merged_into_id, s.id) into v_subject from academics.subjects s where s.id = v_module.subject_id;
  if v_subject is null then
    return jsonb_build_object('subject', null);
  end if;
  return jsonb_build_object(
    'subject', (select jsonb_build_object('id', s.id, 'name', s.name) from academics.subjects s where s.id = v_subject),
    'universities', (select count(distinct m.institution_id) from academics.modules m
                     join academics.subjects s on s.id = m.subject_id
                     where coalesce(s.merged_into_id, s.id) = v_subject and m.merged_into_id is null),
    'national_files', (select count(*) from content.resources r
                       join academics.modules m on m.id = r.module_id
                       join academics.subjects s on s.id = m.subject_id
                       where coalesce(s.merged_into_id, s.id) = v_subject and r.scope = 'national'
                         and r.status = 'live' and r.deleted_at is null
                         and r.institution_id <> v_module.institution_id),
    'can_edit', identity.is_staff_for(v_module.institution_id) or exists (
      select 1 from academics.cohort_modules cm
      join academics.cohort_members me on me.cohort_id = cm.cohort_id and me.user_id = (select auth.uid())
      where cm.module_id = v_module.id and academics.can_edit_cohort(cm.cohort_id)));
end;
$$;
grant execute on function api.module_subject(bigint) to authenticated;

-- Subjects matching what a rep types, for correcting a module's subject.
create or replace function api.find_subjects(p_query text)
returns table (id bigint, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.name from academics.subjects s
  where s.merged_into_id is null and char_length(btrim(coalesce(p_query, ''))) >= 2
    and (s.name ilike '%' || btrim(p_query) || '%' or extensions.similarity(s.name, btrim(p_query)) > 0.3)
    and (select identity.is_active_user())
  order by extensions.similarity(s.name, btrim(p_query)) desc, s.name
  limit 8;
$$;
grant execute on function api.find_subjects(text) to authenticated;

-- Reps of a batch listing the module, and moderators, correct its subject (an existing one by name,
-- or a new one). Audited.
create or replace function api.set_module_subject(p_module_id bigint, p_subject text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_module academics.modules;
  v_name text := btrim(regexp_replace(coalesce(p_subject, ''), '\s+', ' ', 'g'));
  v_key text;
  v_subject bigint;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v_module := content.my_module(p_module_id);
  if not identity.is_staff_for(v_module.institution_id) and not exists (
    select 1 from academics.cohort_modules cm
    join academics.cohort_members me on me.cohort_id = cm.cohort_id and me.user_id = v_uid
    where cm.module_id = v_module.id and academics.can_edit_cohort(cm.cohort_id)
  ) then
    raise exception 'Only batch reps and moderators can change a module''s subject.' using errcode = '42501';
  end if;
  if char_length(v_name) not between 2 and 120 or v_name ~ '[<>{}\[\]\\]' then
    raise exception 'Subject names are 2 to 120 characters.' using errcode = '22023';
  end if;
  perform messaging.hit_limit('set_subject', 20, 'You have changed a lot of subjects today. Try again tomorrow.');
  v_key := lower(regexp_replace(v_name, '[^[:alnum:]]+', '', 'g'));
  insert into academics.subjects (name) values (v_name) on conflict do nothing;
  select coalesce(s.merged_into_id, s.id) into v_subject from academics.subjects s where s.name_key = v_key;
  update academics.modules m set subject_id = v_subject where m.id = v_module.id;
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_uid, 'modules.set_subject', 'academics.modules', v_module.id::text,
          jsonb_build_object('from', v_module.subject_id, 'to', v_subject));
  return api.module_subject(v_module.id);
end;
$$;
grant execute on function api.set_module_subject(bigint, text) to authenticated;

-- National admins merge two subjects that are the same.
create or replace function api.merge_subjects(p_from bigint, p_into bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not identity.is_national_admin() then
    raise exception 'Only national admins can merge subjects.' using errcode = '42501';
  end if;
  if p_from = p_into or not exists (select 1 from academics.subjects s where s.id = p_into and s.merged_into_id is null) then
    raise exception 'Choose two different subjects.' using errcode = '22023';
  end if;
  update academics.subjects s set merged_into_id = p_into where s.id = p_from or s.merged_into_id = p_from;
  update academics.modules m set subject_id = p_into where m.subject_id = p_from;
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values ((select auth.uid()), 'subjects.merge', 'academics.subjects', p_into::text, jsonb_build_object('from', p_from));
end;
$$;
grant execute on function api.merge_subjects(bigint, bigint) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Publishing: who sees it (university or all universities), and no duplicates
-- ---------------------------------------------------------------------------------------------

drop function api.begin_publish(uuid, bigint, text, text, integer);
create or replace function api.begin_publish(
  p_message_id uuid,
  p_module_id bigint,
  p_category text,
  p_title text default null,
  p_paper_year integer default null,
  p_scope text default 'university'
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
  v_kind text;
  v_role text;
  v_module academics.modules;
  v_id uuid := ops.uuid_v7();
  v_key text;
  v_title text;
  v_existing record;
begin
  select i.* into v_item from content.chat_items i
  where i.message_id = p_message_id and i.deleted_at is null and i.kind in ('file', 'image');
  select c.kind, m.role into v_kind, v_role
  from messaging.conversations c
  join messaging.conversation_members m on m.conversation_id = c.id and m.user_id = v_uid
  where c.id = v_item.conversation_id;
  if v_item.message_id is null or v_kind is null then
    raise exception 'That file is not available.' using errcode = '22023';
  end if;
  if v_item.sender_id is distinct from v_uid and not (v_kind = 'cohort' and v_role = 'admin') then
    raise exception 'Only the person who sent it, or a batch rep, can share it with the university.' using errcode = '42501';
  end if;
  if p_scope is null or p_scope not in ('university', 'national') then
    raise exception 'Choose who can see it.' using errcode = '22023';
  end if;
  if exists (select 1 from content.resources r where r.source_message_id = p_message_id and r.deleted_at is null) then
    raise exception 'This file is already shared.' using errcode = '22023';
  end if;
  v_title := btrim(coalesce(nullif(btrim(p_title), ''), regexp_replace(v_item.title, '\.[A-Za-z0-9]{2,5}$', '')));
  v_module := content.publish_checks(p_module_id, p_category, v_title, v_item.mime, v_item.size, p_paper_year);
  if v_item.sha256 is not null then
    select r.title, m.code into v_existing from content.resources r join academics.modules m on m.id = r.module_id
    where r.institution_id = v_module.institution_id and r.sha256 = v_item.sha256 and r.status = 'live' and r.deleted_at is null
    limit 1;
    if v_existing.title is not null then
      raise exception 'Already shared as “%” in %.', v_existing.title, v_existing.code using errcode = '22023';
    end if;
  end if;
  v_key := 'resources/' || v_id || '.' || content.resource_ext(v_item.mime);

  insert into content.resources (id, module_id, institution_id, uploader_id, title, kind, storage_key, mime_type, size_bytes,
    status, paper_year, source_message_id, source_path, published_as, scope)
  values (v_id, v_module.id, v_module.institution_id, v_uid, left(v_title, 160), p_category, v_key, v_item.mime, v_item.size,
    'pending', p_paper_year, p_message_id, v_item.path, case when v_item.sender_id = v_uid then 'owner' else 'rep' end, p_scope);
  return jsonb_build_object('resource_id', v_id, 'key', v_key, 'source_path', v_item.path, 'mime', v_item.mime);
end;
$$;
grant execute on function api.begin_publish(uuid, bigint, text, text, integer, text) to authenticated;

drop function api.begin_resource_upload(bigint, text, text, text, integer, integer);
create or replace function api.begin_resource_upload(
  p_module_id bigint,
  p_category text,
  p_title text,
  p_mime text,
  p_size integer,
  p_paper_year integer default null,
  p_scope text default 'university'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_module academics.modules;
  v_id uuid := ops.uuid_v7();
  v_key text;
begin
  if p_scope is null or p_scope not in ('university', 'national') then
    raise exception 'Choose who can see it.' using errcode = '22023';
  end if;
  v_module := content.publish_checks(p_module_id, p_category, p_title, p_mime, p_size, p_paper_year);
  v_key := 'resources/' || v_id || '.' || content.resource_ext(p_mime);
  insert into content.resources (id, module_id, institution_id, uploader_id, title, kind, storage_key, mime_type, size_bytes,
    status, paper_year, scope)
  values (v_id, v_module.id, v_module.institution_id, v_uid, left(btrim(p_title), 160), p_category, v_key, p_mime, p_size,
    'pending', p_paper_year, p_scope);
  return jsonb_build_object('resource_id', v_id, 'key', v_key, 'mime', p_mime, 'size', p_size);
end;
$$;
grant execute on function api.begin_resource_upload(bigint, text, text, text, integer, integer, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Reading shared files: own university, or shared with all universities
-- ---------------------------------------------------------------------------------------------

-- A shared file the caller may see, or an error.
create or replace function content.visible_resource(p_resource_id uuid)
returns content.resources
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_resource content.resources;
  v_uid uuid := (select auth.uid());
begin
  select r.* into v_resource from content.resources r
  where r.id = p_resource_id and r.deleted_at is null and r.status = 'live'
    and (r.institution_id = (select identity.current_institution_id()) or r.scope = 'national')
    and not exists (select 1 from safety.blocks b
                    where (b.blocker_id = v_uid and b.blocked_id = r.uploader_id) or (b.blocker_id = r.uploader_id and b.blocked_id = v_uid));
  if v_resource.id is null then
    raise exception 'That file is not available.' using errcode = 'P0002';
  end if;
  return v_resource;
end;
$$;
revoke execute on function content.visible_resource(uuid) from public, anon, authenticated;

create or replace function content.resource_json(r content.resources, p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', r.id,
    'title', r.title,
    'category', r.kind,
    'paper_year', r.paper_year,
    'mime', r.mime_type,
    'size', r.size_bytes,
    'key', r.storage_key,
    'status', r.status,
    'check_reason', r.check_reason,
    'published_as', r.published_as,
    'scope', r.scope,
    'comment_count', r.comment_count,
    'created_at', r.created_at,
    'mine', r.uploader_id = p_uid,
    'uploader_name', (select p.full_name from identity.profiles p where p.user_id = r.uploader_id),
    'institution', (select coalesce(i.short_name, i.name) from identity.institutions i where i.id = r.institution_id),
    'module', (select jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name) from academics.modules m where m.id = r.module_id)));
$$;

-- Shared files, newest first. Own university by default (optionally one module); p_national: files
-- shared with all universities by students elsewhere (for a module: those of the same subject).
-- Search matches names, module codes and the text inside files (with the matching line).
drop function api.explore(bigint, text, text, timestamptz, integer);
create or replace function api.explore(
  p_module_id bigint default null,
  p_category text default null,
  p_query text default null,
  p_before timestamptz default null,
  p_limit integer default 40,
  p_national boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint;
  v_module bigint;
  v_subject bigint;
  v_query text := btrim(coalesce(p_query, ''));
  v_key text := upper(regexp_replace(coalesce(p_query, ''), '[^[:alnum:]]+', '', 'g'));
  v_like text;
  v_ts tsquery;
  v_search boolean;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v_institution := (select identity.current_institution_id());
  if p_module_id is not null then
    v_module := (content.my_module(p_module_id)).id;
    select coalesce(s.merged_into_id, s.id) into v_subject
    from academics.modules m join academics.subjects s on s.id = m.subject_id where m.id = v_module;
  end if;
  v_search := char_length(v_query) >= 2;
  v_like := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_ts := plainto_tsquery('simple', v_query);

  return coalesce((
    select jsonb_agg(content.resource_json(x.r, v_uid)
             || jsonb_strip_nulls(jsonb_build_object('snippet', case when v_search and not x.title_hit then content.snippet(x.sha256, v_ts) end))
             order by x.created_at desc)
    from (
      select r, r.created_at, r.sha256,
        (not v_search or r.title ilike v_like or r.search @@ v_ts or (v_key <> '' and m.code_key like v_key || '%')) as title_hit
      from content.resources r
      join academics.modules m on m.id = r.module_id
      left join academics.subjects s on s.id = m.subject_id
      where r.status = 'live' and r.deleted_at is null
        and case when p_national
              then r.scope = 'national' and r.institution_id <> v_institution
                   and (v_module is null or (v_subject is not null and coalesce(s.merged_into_id, s.id) = v_subject))
              else r.institution_id = v_institution and (v_module is null or r.module_id = v_module)
            end
        and (p_category is null or r.kind = p_category)
        and (p_before is null or r.created_at < p_before)
        and (not v_search
             or r.title ilike v_like
             or r.search @@ v_ts
             or extensions.similarity(r.title, v_query) > 0.3
             or (v_key <> '' and m.code_key like v_key || '%')
             or exists (select 1 from content.file_text f where f.sha256 = r.sha256 and f.search @@ v_ts))
        and not exists (select 1 from safety.blocks b
                        where (b.blocker_id = v_uid and b.blocked_id = r.uploader_id) or (b.blocker_id = r.uploader_id and b.blocked_id = v_uid))
      order by r.created_at desc
      limit least(greatest(coalesce(p_limit, 40), 1), 100)
    ) x), '[]'::jsonb);
end;
$$;
grant execute on function api.explore(bigint, text, text, timestamptz, integer, boolean) to authenticated;

-- The uploader's waiting, refused or duplicate files are listed with the reason.
create or replace function api.explore_overview()
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
  return jsonb_build_object(
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object('module_id', m.module_id, 'count', (
        select count(*) from content.resources r
        where r.module_id = m.module_id and r.status = 'live' and r.deleted_at is null)) order by m.is_current desc, m.code_key)
      from content.my_modules_for(v_uid) m), '[]'::jsonb),
    'mine', coalesce((
      select jsonb_agg(content.resource_json(r, v_uid) order by r.created_at desc)
      from content.resources r
      where r.uploader_id = v_uid and r.deleted_at is null and r.status in ('pending', 'quarantined', 'duplicate')
        and r.created_at > now() - interval '30 days'), '[]'::jsonb)
  );
end;
$$;

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
    and not exists (select 1 from content.chat_items b where b.path = r.path and b.check_status = 'blocked')
  union
  select i.path from content.chat_items i
  join content.library_items li on li.message_id = i.message_id and li.user_id = (select auth.uid())
  where i.path = any (p_paths[1:100]) and li.saved and not li.hidden and i.deleted_at is null
    and i.check_status <> 'blocked' and (select identity.is_active_user())
  union
  select r.storage_key from content.resources r
  where r.storage_key = any (p_paths[1:100]) and r.deleted_at is null and (select identity.is_active_user())
    and ((r.status = 'live' and (r.institution_id = (select identity.current_institution_id()) or r.scope = 'national'))
         or (r.uploader_id = (select auth.uid()) and r.status in ('pending', 'quarantined', 'duplicate')));
$$;

-- Reports reach the moderators of the uploader's university, also for files shared nationally.
create or replace function api.report_resource(p_resource_id uuid, p_category text, p_details text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_resource content.resources;
  v_id uuid;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v_resource := content.visible_resource(p_resource_id);
  if v_resource.uploader_id = v_uid then
    raise exception 'You shared this file. Remove it instead.' using errcode = '22023';
  end if;
  if not exists (select 1 from safety.report_categories rc where rc.code = p_category) then
    raise exception 'Choose what is wrong.' using errcode = '22023';
  end if;
  if p_details is not null and char_length(p_details) > 1000 then
    raise exception 'Keep the details under 1,000 characters.' using errcode = '22023';
  end if;
  select r.id into v_id from safety.reports r
  where r.reporter_id = v_uid and r.target_kind = 'resource' and r.target_id = p_resource_id::text and r.status = 'open';
  if v_id is not null then
    return v_id;
  end if;
  perform messaging.hit_limit('report', 20, 'You have sent a lot of reports today. Our team will look at them first.');
  insert into safety.reports (reporter_id, institution_id, target_kind, target_id, category_code, details, snapshot)
  values (v_uid, v_resource.institution_id, 'resource', p_resource_id::text, p_category,
          nullif(btrim(coalesce(p_details, '')), ''), content.resource_json(v_resource, v_uid) || jsonb_build_object('uploader_id', v_resource.uploader_id))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Discussions on shared files
-- ---------------------------------------------------------------------------------------------

create table content.comments (
  id uuid primary key default ops.uuid_v7(),
  resource_id uuid not null references content.resources (id) on delete cascade,
  author_id uuid references identity.profiles (user_id) on delete set null,
  -- One level of replies.
  parent_id uuid references content.comments (id) on delete cascade,
  -- Which question of the paper it is about ("Q3(B)"); null for the paper as a whole.
  question text check (question ~ '^[A-Z0-9 ().-]{1,16}$'),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  votes integer not null default 0 check (votes >= 0),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index comments_resource_idx on content.comments (resource_id, question, created_at);
create index comments_author_idx on content.comments (author_id);
create index comments_parent_idx on content.comments (parent_id);

create table content.comment_votes (
  comment_id uuid not null references content.comments (id) on delete cascade,
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index comment_votes_user_idx on content.comment_votes (user_id);

alter table content.comments enable row level security;
alter table content.comment_votes enable row level security;

create or replace function content.count_comment_votes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update content.comments c set votes = c.votes + 1 where c.id = new.comment_id;
  else
    update content.comments c set votes = greatest(c.votes - 1, 0) where c.id = old.comment_id;
  end if;
  return null;
end;
$$;
revoke execute on function content.count_comment_votes() from public, anon, authenticated;
create trigger comment_votes_count after insert or delete on content.comment_votes
  for each row execute function content.count_comment_votes();

-- Comment counts on files: new comments add, deleted ones take away.
create or replace function content.count_comments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update content.resources r set comment_count = r.comment_count + 1 where r.id = new.resource_id;
  elsif old.deleted_at is null and new.deleted_at is not null then
    update content.resources r set comment_count = greatest(r.comment_count - 1, 0) where r.id = new.resource_id;
  end if;
  return null;
end;
$$;
revoke execute on function content.count_comments() from public, anon, authenticated;
create trigger comments_count after insert or update of deleted_at on content.comments
  for each row execute function content.count_comments();

-- "q3 b" -> "Q3 B"; null when empty.
create or replace function content.question_label(p_question text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(upper(btrim(regexp_replace(coalesce(p_question, ''), '\s+', ' ', 'g'))), '');
$$;

create or replace function content.comment_json(c content.comments, p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', c.id,
    'question', c.question,
    'body', case when c.deleted_at is null then c.body end,
    'deleted', c.deleted_at is not null,
    'votes', c.votes,
    'voted', exists (select 1 from content.comment_votes v where v.comment_id = c.id and v.user_id = p_uid),
    'mine', c.author_id = p_uid,
    'created_at', c.created_at,
    'edited', c.edited_at is not null,
    'author', (select jsonb_build_object('id', p.user_id, 'name', p.full_name, 'avatar_path', p.avatar_path)
               from identity.profiles p where p.user_id = c.author_id and c.deleted_at is null)));
$$;
revoke execute on function content.comment_json(content.comments, uuid) from public, anon, authenticated;

-- A shared file and its discussion summary: which questions have answers, and how many.
create or replace function api.resource(p_resource_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_resource content.resources;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v_resource := content.visible_resource(p_resource_id);
  return content.resource_json(v_resource, v_uid) || jsonb_build_object(
    'can_moderate', identity.is_staff_for(v_resource.institution_id),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('question', q.question, 'count', q.n) order by q.question)
      from (select c.question, count(*) as n from content.comments c
            where c.resource_id = p_resource_id and c.parent_id is null and c.deleted_at is null and c.question is not null
            group by c.question) q), '[]'::jsonb));
end;
$$;
grant execute on function api.resource(uuid) to authenticated;

-- A file's discussion (or one question's), most helpful first, with replies oldest first.
-- Comments by students blocked either way are left out.
create or replace function api.comments(p_resource_id uuid, p_question text default null, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_question text := content.question_label(p_question);
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  perform content.visible_resource(p_resource_id);
  return coalesce((
    select jsonb_agg(content.comment_json(x.c, v_uid) || jsonb_build_object('replies', coalesce((
             select jsonb_agg(content.comment_json(r, v_uid) order by r.created_at)
             from content.comments r
             where r.parent_id = (x.c).id
               and not exists (select 1 from safety.blocks b
                               where (b.blocker_id = v_uid and b.blocked_id = r.author_id) or (b.blocker_id = r.author_id and b.blocked_id = v_uid))),
             '[]'::jsonb)) order by x.deleted, x.votes desc, x.created_at)
    from (
      select c, c.deleted_at is not null as deleted, c.votes, c.created_at from content.comments c
      where c.resource_id = p_resource_id and c.parent_id is null
        and (v_question is null or c.question = v_question)
        and not exists (select 1 from safety.blocks b
                        where (b.blocker_id = v_uid and b.blocked_id = c.author_id) or (b.blocker_id = c.author_id and b.blocked_id = v_uid))
      order by c.deleted_at is not null, c.votes desc, c.created_at
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    ) x), '[]'::jsonb);
end;
$$;
grant execute on function api.comments(uuid, text, integer) to authenticated;

-- Answers or comments on a file (optionally a question), or replies to a comment. 60 a day.
create or replace function api.add_comment(p_resource_id uuid, p_body text, p_question text default null, p_parent_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_question text := content.question_label(p_question);
  v_parent content.comments;
  v_comment content.comments;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  perform content.visible_resource(p_resource_id);
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'Comments are 1 to 2,000 characters.' using errcode = '22023';
  end if;
  if v_question is not null and v_question !~ '^[A-Z0-9 ().-]{1,16}$' then
    raise exception 'Name the question like Q3 or Q3(b).' using errcode = '22023';
  end if;
  if p_parent_id is not null then
    select c.* into v_parent from content.comments c
    where c.id = p_parent_id and c.resource_id = p_resource_id and c.parent_id is null and c.deleted_at is null;
    if v_parent.id is null then
      raise exception 'That comment is not available.' using errcode = '22023';
    end if;
    v_question := v_parent.question;
  end if;
  perform messaging.hit_limit('comment', 60, 'You have commented a lot today. Try again tomorrow.');
  insert into content.comments (resource_id, author_id, parent_id, question, body)
  values (p_resource_id, v_uid, p_parent_id, v_question, v_body)
  returning * into v_comment;
  return content.comment_json(v_comment, v_uid);
end;
$$;
grant execute on function api.add_comment(uuid, text, text, uuid) to authenticated;

create or replace function api.edit_comment(p_comment_id uuid, p_body text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_comment content.comments;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'Comments are 1 to 2,000 characters.' using errcode = '22023';
  end if;
  update content.comments c set body = v_body, edited_at = now()
  where c.id = p_comment_id and c.author_id = v_uid and c.deleted_at is null
  returning * into v_comment;
  if v_comment.id is null then
    raise exception 'You can only edit your own comments.' using errcode = '42501';
  end if;
  return content.comment_json(v_comment, v_uid);
end;
$$;
grant execute on function api.edit_comment(uuid, text) to authenticated;

-- Deletes a comment: its author, or moderators of the file's university (audited).
create or replace function api.delete_comment(p_comment_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_comment content.comments;
  v_institution bigint;
begin
  select c.* into v_comment from content.comments c where c.id = p_comment_id and c.deleted_at is null;
  select r.institution_id into v_institution from content.resources r where r.id = v_comment.resource_id;
  if v_uid is null or v_comment.id is null or not (select identity.is_active_user()) then
    raise exception 'That comment is not available.' using errcode = 'P0002';
  end if;
  if v_comment.author_id is distinct from v_uid then
    if not identity.is_staff_for(v_institution) then
      raise exception 'You can only delete your own comments.' using errcode = '42501';
    end if;
    insert into ops.audit_log (actor_id, action, target_table, target_id, details)
    values (v_uid, 'comments.delete', 'content.comments', p_comment_id::text,
            jsonb_build_object('author_id', v_comment.author_id, 'body', v_comment.body));
  end if;
  update content.comments c set deleted_at = now() where c.id = p_comment_id;
end;
$$;
grant execute on function api.delete_comment(uuid) to authenticated;

-- "Helpful": one vote per student per comment; not on your own.
create or replace function api.vote_comment(p_comment_id uuid, p_on boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_comment content.comments;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select c.* into v_comment from content.comments c where c.id = p_comment_id and c.deleted_at is null;
  if v_comment.id is null then
    raise exception 'That comment is not available.' using errcode = 'P0002';
  end if;
  perform content.visible_resource(v_comment.resource_id);
  if v_comment.author_id = v_uid then
    raise exception 'You cannot vote for your own comment.' using errcode = '22023';
  end if;
  if p_on then
    perform messaging.hit_limit('vote_comment', 300, 'You have voted a lot today. Try again tomorrow.');
    insert into content.comment_votes (comment_id, user_id) values (p_comment_id, v_uid) on conflict do nothing;
  else
    delete from content.comment_votes v where v.comment_id = p_comment_id and v.user_id = v_uid;
  end if;
  select c.* into v_comment from content.comments c where c.id = p_comment_id;
  return content.comment_json(v_comment, v_uid);
end;
$$;
grant execute on function api.vote_comment(uuid, boolean) to authenticated;

create or replace function api.report_comment(p_comment_id uuid, p_category text, p_details text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_comment content.comments;
  v_resource content.resources;
  v_id uuid;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select c.* into v_comment from content.comments c where c.id = p_comment_id and c.deleted_at is null;
  if v_comment.id is null then
    raise exception 'That comment is not available.' using errcode = 'P0002';
  end if;
  v_resource := content.visible_resource(v_comment.resource_id);
  if v_comment.author_id = v_uid then
    raise exception 'You cannot report your own comment.' using errcode = '22023';
  end if;
  if not exists (select 1 from safety.report_categories rc where rc.code = p_category) then
    raise exception 'Choose what is wrong.' using errcode = '22023';
  end if;
  select r.id into v_id from safety.reports r
  where r.reporter_id = v_uid and r.target_kind = 'comment' and r.target_id = p_comment_id::text and r.status = 'open';
  if v_id is not null then
    return v_id;
  end if;
  perform messaging.hit_limit('report', 20, 'You have sent a lot of reports today. Our team will look at them first.');
  insert into safety.reports (reporter_id, institution_id, target_kind, target_id, category_code, details, snapshot)
  values (v_uid, (select p.institution_id from identity.profiles p where p.user_id = v_comment.author_id), 'comment',
          p_comment_id::text, p_category, nullif(btrim(coalesce(p_details, '')), ''),
          jsonb_build_object('comment', content.comment_json(v_comment, v_uid), 'author_id', v_comment.author_id,
                             'resource', content.resource_json(v_resource, v_uid)))
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function api.report_comment(uuid, text, text) to authenticated;
