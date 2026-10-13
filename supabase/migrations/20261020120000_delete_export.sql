-- Deleting an account and downloading your data (PDPA rights to erasure and access; both stores
-- require in-app deletion).
--
--   Download   api.export_my_data returns everything Uni Era keeps that the student made or that
--              is about them, as one JSON document the app saves to the phone. Nothing is stored on
--              a server for it. Once a day.
--   Delete     the student retypes their email; the account is deleted after 30 days. Signing in
--              meanwhile shows the date and a Keep my account button (the token carries
--              deleting_at). On the day, a cron job deletes the account: profile, photo, posts,
--              comments, listings, shared files, direct chats, letter and the sign-in itself. Group
--              messages stay, shown as from "Deleted account", so conversations still make sense.
--              Reports about the student and moderation records are kept for safety (the student's
--              name is gone from them); the audit log keeps only that an account was deleted.
--   Files      paths of files to delete go in ops.file_deletions; the media function empties it
--              (cron every 30 minutes, like letters).

create table identity.deletion_requests (
  user_id uuid primary key references identity.profiles (user_id) on delete cascade,
  requested_at timestamptz not null default now(),
  delete_after timestamptz not null
);
create index deletion_requests_due_idx on identity.deletion_requests (delete_after);
alter table identity.deletion_requests enable row level security;

-- Moderation records outlive the account (safety), without the person.
alter table safety.moderation_actions drop constraint moderation_actions_subject_user_id_fkey;
alter table safety.moderation_actions add constraint moderation_actions_subject_user_id_fkey
  foreign key (subject_user_id) references identity.profiles (user_id) on delete set null;

create table ops.file_deletions (
  bucket text not null check (bucket in ('public', 'chat')),
  path text not null,
  queued_at timestamptz not null default now(),
  primary key (bucket, path)
);
alter table ops.file_deletions enable row level security;

-- The token says when the account is due to be deleted, so the app can offer to keep it.
create or replace function identity.custom_access_token(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id uuid := (event ->> 'user_id')::uuid;
  v_claims jsonb := event -> 'claims';
  v_status text;
  v_institution_id bigint;
  v_staff_role text;
  v_name_confirmed boolean;
  v_kind text;
  v_until timestamptz;
  v_deleting timestamptz;
begin
  select p.account_status, p.institution_id, p.name_confirmed_at is not null, p.account_kind, p.fresher_until
    into v_status, v_institution_id, v_name_confirmed, v_kind, v_until
  from identity.profiles p
  where p.user_id = v_user_id;

  select d.delete_after into v_deleting from identity.deletion_requests d where d.user_id = v_user_id;

  select case
           when bool_or(s.role = 'admin') then 'admin'
           when bool_or(s.role = 'moderator') then 'moderator'
         end
    into v_staff_role
  from identity.staff_roles s
  where s.user_id = v_user_id;

  if jsonb_typeof(v_claims -> 'app_metadata') is distinct from 'object' then
    v_claims := jsonb_set(v_claims, '{app_metadata}', '{}'::jsonb);
  end if;

  v_claims := jsonb_set(v_claims, '{app_metadata,account_status}', to_jsonb(coalesce(v_status, 'pending')));
  v_claims := jsonb_set(v_claims, '{app_metadata,institution_id}', coalesce(to_jsonb(v_institution_id), 'null'::jsonb));
  v_claims := jsonb_set(v_claims, '{app_metadata,staff_role}', coalesce(to_jsonb(v_staff_role), 'null'::jsonb));
  v_claims := jsonb_set(v_claims, '{app_metadata,name_confirmed}', to_jsonb(coalesce(v_name_confirmed, false)));
  v_claims := jsonb_set(v_claims, '{app_metadata,account_kind}', to_jsonb(coalesce(v_kind, 'student')));
  v_claims := jsonb_set(v_claims, '{app_metadata,fresher_until}',
    coalesce(to_jsonb(extract(epoch from v_until)::bigint), 'null'::jsonb));
  v_claims := jsonb_set(v_claims, '{app_metadata,deleting_at}',
    coalesce(to_jsonb(extract(epoch from v_deleting)::bigint), 'null'::jsonb));

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;
grant select on identity.deletion_requests to supabase_auth_admin;
create policy "auth admin reads deletion requests" on identity.deletion_requests
  for select to supabase_auth_admin using (true);

-- ---------------------------------------------------------------------------------------------
-- Asking, and changing your mind
-- ---------------------------------------------------------------------------------------------

create or replace function api.request_deletion(p_email text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_after timestamptz;
begin
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is null then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if lower(btrim(coalesce(p_email, ''))) <> v_email then
    raise exception 'Type the email you sign in with, exactly.' using errcode = '22023';
  end if;
  insert into identity.deletion_requests (user_id, delete_after) values (v_uid, now() + interval '30 days')
  on conflict (user_id) do nothing;
  select d.delete_after into v_after from identity.deletion_requests d where d.user_id = v_uid;
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_uid, 'account.deletion_requested', 'identity.profiles', v_uid::text, jsonb_build_object('delete_after', v_after));
  return v_after;
end;
$$;
revoke execute on function api.request_deletion(text) from public, anon;
grant execute on function api.request_deletion(text) to authenticated;

create or replace function api.cancel_deletion()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  delete from identity.deletion_requests d where d.user_id = v_uid;
  if found then
    insert into ops.audit_log (actor_id, action, target_table, target_id, details)
    values (v_uid, 'account.deletion_cancelled', 'identity.profiles', v_uid::text, '{}'::jsonb);
  end if;
end;
$$;
revoke execute on function api.cancel_deletion() from public, anon;
grant execute on function api.cancel_deletion() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Deleting
-- ---------------------------------------------------------------------------------------------

create or replace function identity.delete_account(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- Files first, while the rows that name them still exist.
  insert into ops.file_deletions (bucket, path)
  select 'public', p.avatar_path from identity.profiles p where p.user_id = p_user_id and p.avatar_path is not null
  union all
  select 'public', 'posts/' || (x ->> 'id') || s.suffix
  from feed.posts fp, jsonb_array_elements(fp.photos) x, (values ('.jpg'), ('.full.jpg')) s (suffix)
  where fp.author_id = p_user_id
  union all
  select 'chat', u.path from shop.uploads u where u.user_id = p_user_id
  union all
  select 'chat', r.storage_key from content.resources r where r.uploader_id = p_user_id and r.storage_key is not null
  union all
  select 'chat', u.path from messaging.uploads u
  join messaging.conversations c on c.id = u.conversation_id and c.kind = 'direct'
  where u.user_id = p_user_id
  on conflict do nothing;

  perform identity.forget_letter(p_user_id);
  delete from content.resources r where r.uploader_id = p_user_id;
  -- Direct chats go for both people; group chats keep the messages, without the sender.
  delete from messaging.conversations c
  where c.kind = 'direct'
    and exists (select 1 from messaging.direct_conversations d
                where d.conversation_id = c.id and p_user_id in (d.user_low, d.user_high));

  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (null, 'account.deleted', 'identity.profiles', p_user_id::text, '{}'::jsonb);
  -- The sign-in itself; everything that belongs to the profile goes with it (cascade), and what
  -- must outlive it (group messages, reports, moderation records) loses the link.
  delete from auth.users u where u.id = p_user_id;
end;
$$;
revoke execute on function identity.delete_account(uuid) from public, anon, authenticated;

create or replace function identity.run_deletions()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  for v_user in
    select d.user_id from identity.deletion_requests d where d.delete_after <= now() order by d.delete_after limit 200
  loop
    perform identity.delete_account(v_user);
  end loop;
end;
$$;
revoke execute on function identity.run_deletions() from public, anon, authenticated;

-- For the media function (service role): files to delete, then confirmation they are gone.
create or replace function api.files_to_delete(p_limit integer default 200)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('bucket', f.bucket, 'path', f.path)), '[]'::jsonb) from (
    select f.bucket, f.path from ops.file_deletions f order by f.queued_at limit least(greatest(p_limit, 1), 500)
  ) f;
$$;
revoke execute on function api.files_to_delete(integer) from public, anon, authenticated;
grant execute on function api.files_to_delete(integer) to service_role;

create or replace function api.files_deleted(p_files jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from ops.file_deletions f
  using jsonb_array_elements(p_files) x
  where f.bucket = x ->> 'bucket' and f.path = x ->> 'path';
$$;
revoke execute on function api.files_deleted(jsonb) from public, anon, authenticated;
grant execute on function api.files_deleted(jsonb) to service_role;

-- Asks the media function to empty the queue (Vault: media_function_url and media_function_secret,
-- the same value as the function's MEDIA_SECRET).
create or replace function ops.request_file_cleanup()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from ops.file_deletions) then
    return;
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'media_function_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'media_function_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('action', 'cleanup'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-media-secret', v_secret),
    timeout_milliseconds := 30000
  );
end;
$$;
revoke execute on function ops.request_file_cleanup() from public, anon, authenticated;

select cron.schedule('account-deletions', '40 20 * * *', $$select identity.run_deletions()$$); -- 2:10 am in Sri Lanka
select cron.schedule('files-cleanup', '15,45 * * * *', $$select ops.request_file_cleanup()$$);

-- ---------------------------------------------------------------------------------------------
-- Download my data
-- ---------------------------------------------------------------------------------------------

create or replace function api.export_my_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not exists (select 1 from identity.profiles p where p.user_id = v_uid) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  perform messaging.hit_limit('export', 3, 'You can download your data 3 times a day. Try again tomorrow.');
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_uid, 'account.exported', 'identity.profiles', v_uid::text, '{}'::jsonb);

  return jsonb_build_object(
    'exported_at', now(),
    'about', 'Everything Uni Era keeps that you made or that is about you. Messages others sent are not included.',
    'account', (
      select jsonb_build_object(
        'email', u.email, 'created_at', u.created_at, 'name', p.full_name, 'about', p.bio, 'photo', p.avatar_path,
        'status', p.account_status, 'kind', p.account_kind,
        'university', (select i.name from identity.institutions i where i.id = p.institution_id),
        'batch', (select academics.batch_name(m.cohort_id) from academics.cohort_members m where m.user_id = p.user_id))
      from identity.profiles p join auth.users u on u.id = p.user_id where p.user_id = v_uid),
    'privacy', (select to_jsonb(s) - 'user_id' from identity.privacy_settings s where s.user_id = v_uid),
    'consents', coalesce((select jsonb_agg(jsonb_build_object('purpose', c.purpose_code, 'version', c.policy_version,
                          'granted', c.granted, 'where', c.source, 'at', c.recorded_at) order by c.recorded_at)
                          from identity.consents c where c.user_id = v_uid), '[]'::jsonb),
    'posts', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'body', f.body, 'tag', f.tag, 'details', f.details,
                       'photos', f.photos, 'status', f.status, 'created_at', f.created_at) order by f.created_at)
                       from feed.posts f where f.author_id = v_uid), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('post_id', c.post_id, 'body', c.body, 'created_at', c.created_at)
                          order by c.created_at) from feed.comments c where c.author_id = v_uid), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('chat', m.conversation_id, 'body', m.body, 'kind', m.kind,
                          'sent_at', m.created_at, 'deleted', m.deleted_at is not null) order by m.created_at)
                          from messaging.messages m where m.sender_id = v_uid), '[]'::jsonb),
    'chats', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'title', c.title, 'joined_at', cm.joined_at))
                       from messaging.conversation_members cm join messaging.conversations c on c.id = cm.conversation_id
                       where cm.user_id = v_uid), '[]'::jsonb),
    'listings', coalesce((select jsonb_agg(to_jsonb(l) - 'seller_id' order by l.created_at)
                          from shop.listings l where l.seller_id = v_uid), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(to_jsonb(o) - 'buyer_id' order by o.created_at)
                        from shop.orders o where o.buyer_id = v_uid), '[]'::jsonb),
    'shared_files', coalesce((select jsonb_agg(jsonb_build_object('title', r.title, 'kind', r.kind, 'status', r.status,
                              'created_at', r.created_at)) from content.resources r where r.uploader_id = v_uid), '[]'::jsonb),
    'freshers_questions', coalesce((select jsonb_agg(jsonb_build_object('body', q.body, 'asked_at', q.created_at))
                                    from freshers.questions q where q.asker_id = v_uid), '[]'::jsonb),
    'reports_you_made', coalesce((select jsonb_agg(jsonb_build_object('about', r.target_kind, 'category', r.category_code,
                                  'details', r.details, 'status', r.status, 'at', r.created_at) order by r.created_at)
                                  from safety.reports r where r.reporter_id = v_uid), '[]'::jsonb),
    'actions_on_your_account', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'reason', a.reason,
                                         'at', a.created_at, 'until', a.expires_at, 'overturned', a.revoked_at is not null)
                                         order by a.created_at)
                                         from safety.moderation_actions a where a.subject_user_id = v_uid and a.action <> 'dismiss'), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(b.blocked_id) from safety.blocks b where b.blocker_id = v_uid), '[]'::jsonb),
    'deletion', (select jsonb_build_object('requested_at', d.requested_at, 'delete_after', d.delete_after)
                 from identity.deletion_requests d where d.user_id = v_uid)
  );
end;
$$;
revoke execute on function api.export_my_data() from public, anon;
grant execute on function api.export_my_data() to authenticated;
