-- Shared library (Explore) and file checks.
--
-- Shared library: notes, past papers and slides published to a module for the whole university.
--   * Publish from the library: a student shares a file they sent; a batch rep may also share
--     files posted in their batch group (lecture material re-posted from the LMS). Or upload a
--     document directly from Explore.
--   * Published files are copied (server side, in R2) to their own key, so deleting the chat
--     message never breaks them, and are read through short-lived signed links like chat files.
--   * Every published file is checked by the `files` Edge Function before anyone sees it: pending
--     until checked, then live, or quarantined with a reason the uploader sees.
--   * Report on every file (copyright included). Moderators remove files; uploaders can remove
--     their own. A student with an upload ban (repeat copyright or abuse) cannot publish.
--   * Up to 20 published files a day per student; PDF, Word, PowerPoint and photos only.
--
-- File checks on chat files: when a document or photo is shared in a chat, the database asks the
-- `files` function to check it (pg_net, after the sender's transaction commits, so sending is not
-- slowed down). The function checks that the file is what its type says, refuses Office files with
-- macros, ActiveX, embedded programs or templates loaded from the internet, PDFs that run scripts,
-- launch programs or carry embedded files, and archives with programs inside. A blocked file can no
-- longer be opened by anyone and leaves every library; the message says it was blocked.
--
-- Setup outside migrations (once per project): Vault secrets `files_function_url` and
-- `files_function_secret`, and the same secret as the function's FILES_SECRET. Without them chat
-- files are not checked (they stay 'pending', which is allowed), and published files wait.

-- ---------------------------------------------------------------------------------------------
-- Chat file checks
-- ---------------------------------------------------------------------------------------------

alter table content.chat_items
  add column check_status text not null default 'pending' check (check_status in ('pending', 'clean', 'blocked', 'skipped')),
  add column check_reason text check (char_length(check_reason) <= 200);
update content.chat_items set check_status = 'skipped' where kind = 'link';

-- Asks the files function to check a new document or photo.
create or replace function content.queue_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if new.kind = 'link' then
    update content.chat_items i set check_status = 'skipped' where i.message_id = new.message_id;
    return null;
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'files_function_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'files_function_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('action', 'check_chat', 'message_id', new.message_id, 'path', new.path, 'mime', new.mime),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-files-secret', v_secret),
    timeout_milliseconds := 30000
  );
  return null;
end;
$$;
revoke execute on function content.queue_check() from public, anon, authenticated;
create trigger chat_items_queue_check after insert on content.chat_items
  for each row execute function content.queue_check();

-- The files function reports a chat file's check (service role only).
create or replace function api.chat_file_checked(p_message_id uuid, p_ok boolean, p_reason text default null)
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
    update content.chat_items i set check_status = 'clean', check_reason = null where i.message_id = p_message_id;
    return;
  end if;
  update content.chat_items i set check_status = 'blocked', check_reason = left(p_reason, 200),
    deleted_at = coalesce(i.deleted_at, now())
  where i.message_id = p_message_id;
  -- The message keeps its place in the chat but says the file was blocked.
  update messaging.messages m set attachment = m.attachment || jsonb_build_object('blocked', true, 'blocked_reason', left(p_reason, 200))
  where m.id = p_message_id and m.created_at = v_item.created_at;
  update content.resources r set status = 'removed', deleted_at = coalesce(r.deleted_at, now())
  where r.source_message_id = p_message_id;
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (null, 'files.blocked', 'content.chat_items', p_message_id::text,
          jsonb_build_object('path', v_item.path, 'reason', p_reason, 'sender_id', v_item.sender_id));
end;
$$;
revoke execute on function api.chat_file_checked(uuid, boolean, text) from public, anon, authenticated;
grant execute on function api.chat_file_checked(uuid, boolean, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Shared library
-- ---------------------------------------------------------------------------------------------

do $$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
    where conrelid = 'content.resources'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table content.resources drop constraint %I', v_name);
  end loop;
end $$;

alter table content.resources
  add constraint resources_kind_check check (kind in ('slides', 'notes', 'past_papers', 'tutorials', 'assignments', 'other')),
  add column institution_id bigint references identity.institutions (id) on delete cascade,
  add column paper_year smallint check (paper_year between 1990 and 2100),
  -- Published from a chat message (the chat file it was copied from).
  add column source_message_id uuid,
  add column source_path text check (char_length(source_path) <= 300),
  add column published_as text not null default 'owner' check (published_as in ('owner', 'rep')),
  add column check_reason text check (char_length(check_reason) <= 200),
  add column checked_at timestamptz;
update content.resources r set institution_id = m.institution_id from academics.modules m where m.id = r.module_id;
alter table content.resources alter column institution_id set not null;
-- One copy per chat file.
create unique index resources_source_message_idx on content.resources (source_message_id)
  where source_message_id is not null and deleted_at is null;
create index resources_institution_live_idx on content.resources (institution_id, created_at desc)
  where status = 'live' and deleted_at is null;

-- Students reach shared files only through the api functions below.
revoke select on content.resources from authenticated;

create table content.upload_bans (
  user_id uuid primary key references identity.profiles (user_id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 300),
  until timestamptz,
  created_by uuid references identity.profiles (user_id) on delete set null,
  created_at timestamptz not null default now()
);
create index upload_bans_created_by_idx on content.upload_bans (created_by);
alter table content.upload_bans enable row level security;

create or replace function content.resource_ext(p_mime text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_mime
    when 'application/pdf' then 'pdf'
    when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx'
    when 'application/vnd.openxmlformats-officedocument.presentationml.presentation' then 'pptx'
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
  end;
$$;

-- Checks shared by both ways of publishing; returns the module.
create or replace function content.publish_checks(p_module_id bigint, p_category text, p_title text, p_mime text, p_size integer, p_paper_year integer)
returns academics.modules
language plpgsql
volatile
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
  if exists (select 1 from content.upload_bans b where b.user_id = v_uid and (b.until is null or b.until > now())) then
    raise exception 'You cannot share files right now. Contact the Uni Era team if you think this is wrong.' using errcode = '42501';
  end if;
  v_module := content.my_module(p_module_id);
  if p_category is null or p_category not in ('slides', 'notes', 'past_papers', 'tutorials', 'assignments', 'other') then
    raise exception 'Choose what kind of file it is.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 160 then
    raise exception 'Give it a name (3 to 160 characters).' using errcode = '22023';
  end if;
  if content.resource_ext(p_mime) is null then
    raise exception 'Only PDF, Word, PowerPoint and photos can be shared.' using errcode = '22023';
  end if;
  if p_size is null or p_size not between 1 and 26214400 then
    raise exception 'Files are up to 25 MB.' using errcode = '22023';
  end if;
  if p_paper_year is not null and p_paper_year not between 1990 and extract(year from now())::integer + 1 then
    raise exception 'Check the paper''s year.' using errcode = '22023';
  end if;
  perform messaging.hit_limit('publish', 20, 'You have shared a lot today. Try again tomorrow.');
  return v_module;
end;
$$;
revoke execute on function content.publish_checks(bigint, text, text, text, integer, integer) from public, anon, authenticated;

-- Publishes a file from a chat. The sender may; so may a rep for files in their batch group.
-- Returns what the files function needs to copy and check it.
create or replace function api.begin_publish(
  p_message_id uuid,
  p_module_id bigint,
  p_category text,
  p_title text default null,
  p_paper_year integer default null
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
  if exists (select 1 from content.resources r where r.source_message_id = p_message_id and r.deleted_at is null) then
    raise exception 'This file is already shared.' using errcode = '22023';
  end if;
  v_title := btrim(coalesce(nullif(btrim(p_title), ''), regexp_replace(v_item.title, '\.[A-Za-z0-9]{2,5}$', '')));
  v_module := content.publish_checks(p_module_id, p_category, v_title, v_item.mime, v_item.size, p_paper_year);
  v_key := 'resources/' || v_id || '.' || content.resource_ext(v_item.mime);

  insert into content.resources (id, module_id, institution_id, uploader_id, title, kind, storage_key, mime_type, size_bytes,
    status, paper_year, source_message_id, source_path, published_as)
  values (v_id, v_module.id, v_module.institution_id, v_uid, left(v_title, 160), p_category, v_key, v_item.mime, v_item.size,
    'pending', p_paper_year, p_message_id, v_item.path, case when v_item.sender_id = v_uid then 'owner' else 'rep' end);
  return jsonb_build_object('resource_id', v_id, 'key', v_key, 'source_path', v_item.path, 'mime', v_item.mime);
end;
$$;
grant execute on function api.begin_publish(uuid, bigint, text, text, integer) to authenticated;

-- Starts a direct upload from Explore. The files function signs the upload for exactly this key,
-- type and size.
create or replace function api.begin_resource_upload(
  p_module_id bigint,
  p_category text,
  p_title text,
  p_mime text,
  p_size integer,
  p_paper_year integer default null
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
  v_module := content.publish_checks(p_module_id, p_category, p_title, p_mime, p_size, p_paper_year);
  v_key := 'resources/' || v_id || '.' || content.resource_ext(p_mime);
  insert into content.resources (id, module_id, institution_id, uploader_id, title, kind, storage_key, mime_type, size_bytes,
    status, paper_year)
  values (v_id, v_module.id, v_module.institution_id, v_uid, left(btrim(p_title), 160), p_category, v_key, p_mime, p_size,
    'pending', p_paper_year);
  return jsonb_build_object('resource_id', v_id, 'key', v_key, 'mime', p_mime, 'size', p_size);
end;
$$;
grant execute on function api.begin_resource_upload(bigint, text, text, text, integer, integer) to authenticated;

-- A pending file of the caller's, for the files function to check.
create or replace function api.pending_resource(p_resource_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('resource_id', r.id, 'key', r.storage_key, 'mime', r.mime_type, 'size', r.size_bytes,
                            'source_path', r.source_path)
  from content.resources r
  where r.id = p_resource_id and r.uploader_id = (select auth.uid()) and r.status = 'pending' and r.deleted_at is null
    and (select identity.is_active_user());
$$;
grant execute on function api.pending_resource(uuid) to authenticated;

-- The files function's verdict on a published file (service role only).
create or replace function api.finish_resource(p_resource_id uuid, p_ok boolean, p_reason text default null, p_size integer default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_resource content.resources;
begin
  update content.resources r set
    status = case when p_ok then 'live' else 'quarantined' end,
    check_reason = case when p_ok then null else left(p_reason, 200) end,
    size_bytes = coalesce(p_size, r.size_bytes),
    checked_at = now()
  where r.id = p_resource_id and r.status = 'pending'
  returning * into v_resource;
  if v_resource.id is not null and not p_ok then
    insert into ops.audit_log (actor_id, action, target_table, target_id, details)
    values (null, 'files.quarantined', 'content.resources', p_resource_id::text,
            jsonb_build_object('reason', p_reason, 'uploader_id', v_resource.uploader_id));
  end if;
  return jsonb_build_object('status', v_resource.status, 'reason', v_resource.check_reason);
end;
$$;
revoke execute on function api.finish_resource(uuid, boolean, text, integer) from public, anon, authenticated;
grant execute on function api.finish_resource(uuid, boolean, text, integer) to service_role;

-- What the app shows for a shared file.
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
    'created_at', r.created_at,
    'mine', r.uploader_id = p_uid,
    'uploader_name', (select p.full_name from identity.profiles p where p.user_id = r.uploader_id),
    'module', (select jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name) from academics.modules m where m.id = r.module_id)));
$$;
revoke execute on function content.resource_json(content.resources, uuid) from public, anon, authenticated;

-- Shared files at the caller's university: by module, category and search words, newest first.
-- Files from students the caller blocked are left out.
create or replace function api.explore(
  p_module_id bigint default null,
  p_category text default null,
  p_query text default null,
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
  v_institution bigint;
  v_module bigint;
  v_query text := btrim(coalesce(p_query, ''));
  v_key text := upper(regexp_replace(coalesce(p_query, ''), '[^[:alnum:]]+', '', 'g'));
  v_like text;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v_institution := (select identity.current_institution_id());
  if p_module_id is not null then
    v_module := (content.my_module(p_module_id)).id;
  end if;
  v_like := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return coalesce((
    select jsonb_agg(content.resource_json(x.r, v_uid) order by x.created_at desc)
    from (
      select r, r.created_at from content.resources r
      left join academics.modules m on m.id = r.module_id
      where r.institution_id = v_institution and r.status = 'live' and r.deleted_at is null
        and (v_module is null or r.module_id = v_module)
        and (p_category is null or r.kind = p_category)
        and (p_before is null or r.created_at < p_before)
        and (char_length(v_query) < 2
             or r.title ilike v_like
             or r.search @@ plainto_tsquery('simple', v_query)
             or extensions.similarity(r.title, v_query) > 0.3
             or (v_key <> '' and m.code_key like v_key || '%'))
        and not exists (select 1 from safety.blocks b
                        where (b.blocker_id = v_uid and b.blocked_id = r.uploader_id) or (b.blocker_id = r.uploader_id and b.blocked_id = v_uid))
      order by r.created_at desc
      limit least(greatest(coalesce(p_limit, 40), 1), 100)
    ) x), '[]'::jsonb);
end;
$$;
grant execute on function api.explore(bigint, text, text, timestamptz, integer) to authenticated;

-- The Explore landing: shared-file counts for the student's modules (this semester first), and
-- their own files that are waiting or were not shared (with the reason).
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
      where r.uploader_id = v_uid and r.deleted_at is null and r.status in ('pending', 'quarantined')
        and r.created_at > now() - interval '30 days'), '[]'::jsonb)
  );
end;
$$;
grant execute on function api.explore_overview() to authenticated;

-- Takes a shared file down: its uploader, or the university's moderators (audited).
create or replace function api.remove_resource(p_resource_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_resource content.resources;
begin
  select r.* into v_resource from content.resources r where r.id = p_resource_id and r.deleted_at is null;
  if v_uid is null or v_resource.id is null or not (select identity.is_active_user()) then
    raise exception 'That file is not available.' using errcode = 'P0002';
  end if;
  if v_resource.uploader_id is distinct from v_uid then
    if not identity.is_staff_for(v_resource.institution_id) then
      raise exception 'Only the person who shared it, or a moderator, can remove it.' using errcode = '42501';
    end if;
    insert into ops.audit_log (actor_id, action, target_table, target_id, details)
    values (v_uid, 'resources.remove', 'content.resources', p_resource_id::text,
            jsonb_build_object('uploader_id', v_resource.uploader_id, 'title', v_resource.title));
  end if;
  update content.resources r set status = 'removed', deleted_at = now() where r.id = p_resource_id;
end;
$$;
grant execute on function api.remove_resource(uuid) to authenticated;

-- Reports a shared file (copyright included) to the university's moderators.
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
  select r.* into v_resource from content.resources r
  where r.id = p_resource_id and r.deleted_at is null and r.status = 'live'
    and r.institution_id = (select identity.current_institution_id());
  if v_resource.id is null then
    raise exception 'That file is not available.' using errcode = 'P0002';
  end if;
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
grant execute on function api.report_resource(uuid, text, text) to authenticated;

-- Moderators: stop a student publishing (repeat copyright or abuse), for some days or until lifted.
create or replace function api.ban_uploader(p_user_id uuid, p_reason text, p_days integer default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint;
begin
  select p.institution_id into v_institution from identity.profiles p where p.user_id = p_user_id;
  if v_uid is null or v_institution is null or not identity.is_staff_for(v_institution) then
    raise exception 'Only moderators can do this.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 300 then
    raise exception 'Give a reason.' using errcode = '22023';
  end if;
  insert into content.upload_bans as b (user_id, reason, until, created_by)
  values (p_user_id, btrim(p_reason), case when p_days is not null then now() + make_interval(days => p_days) end, v_uid)
  on conflict (user_id) do update set reason = excluded.reason, until = excluded.until, created_by = excluded.created_by, created_at = now();
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_uid, 'resources.ban_uploader', 'content.upload_bans', p_user_id::text, jsonb_build_object('reason', p_reason, 'days', p_days));
end;
$$;
grant execute on function api.ban_uploader(uuid, text, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Library: items say whether the student may share them with the university
-- ---------------------------------------------------------------------------------------------

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
    select distinct on (coalesce(i.path, i.url))
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
    order by coalesce(i.path, i.url), (li.message_id is not null) desc, i.created_at desc
  ) v;
$$;

-- Search across the student's own library (names of files, photos and links), newest first.
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
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if char_length(v_query) < 2 then
    return '[]'::jsonb;
  end if;
  v_like := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((
    select jsonb_agg(content.item_json(i, li) order by i.created_at desc)
    from (
      select distinct on (it.k) it.message_id
      from content.my_items(v_uid) it
      where it.title ilike v_like or extensions.word_similarity(v_query, it.title) > 0.5
         or it.codes @> array[upper(regexp_replace(v_query, '[^[:alnum:]]+', '', 'g'))]
      order by it.k, it.created_at desc
      limit least(greatest(coalesce(p_limit, 30), 1), 60)
    ) hit
    join content.chat_items i on i.message_id = hit.message_id
    left join content.library_items li on li.user_id = v_uid and li.message_id = hit.message_id), '[]'::jsonb);
end;
$$;
grant execute on function api.library_search(text, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Reading files: chat files (never blocked ones), saved files, and live shared files at the
-- student's university (plus their own, while waiting).
-- ---------------------------------------------------------------------------------------------

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
    and ((r.status = 'live' and r.institution_id = (select identity.current_institution_id()))
         or (r.uploader_id = (select auth.uid()) and r.status in ('pending', 'quarantined')));
$$;
