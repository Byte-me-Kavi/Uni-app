-- Kuppi requests: they stay until someone hosts them, answered ones leave the list, and the students
-- who asked hear about it.
--
-- 1. A request stays open until a kuppi is hosted for it (there is no expiry). Hosting one closes it
--    and it leaves the list at once (it used to stay 14 days as "answered").
-- 2. Everyone who asked or voted gets a push: "Your kuppi request was answered", with the host, the
--    topic and when. Tapping it opens the kuppi.
-- 3. The student who asked can remove their request only while nobody else wants it (their own vote
--    is the only one); once others have voted it stays until someone hosts it. Moderators still can.
--
-- Notifications outside chats and the shop go through messaging.app_pushes: each event writes one
-- batch, asks the push function to send it (pg_net, after the transaction commits), and
-- api.app_push_batch returns the Expo messages. Quiet hours apply; Android channel "kuppi".

-- ---------------------------------------------------------------------------------------------
-- App notifications (kuppi now; events later)
-- ---------------------------------------------------------------------------------------------

create table messaging.app_pushes (
  id uuid primary key default ops.uuid_v7(),
  batch_id uuid not null,
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  kind text not null check (kind in ('kuppi_answered')),
  title text not null check (char_length(title) <= 80),
  body text not null check (char_length(body) <= 180),
  -- What the app opens when it is tapped, e.g. { "kuppi_id": "..." }.
  data jsonb not null default '{}'::jsonb,
  channel text not null default 'kuppi' check (channel in ('kuppi')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index app_pushes_batch_idx on messaging.app_pushes (batch_id);
create index app_pushes_user_idx on messaging.app_pushes (user_id, created_at desc);
alter table messaging.app_pushes enable row level security;
-- No grants or policies: written by the functions below, read by the push function.

-- Queues one notification to each student (never the one acting), skipping those with no phone
-- registered, inactive accounts and quiet hours.
create or replace function messaging.notify(p_users uuid[], p_kind text, p_title text, p_body text, p_data jsonb, p_channel text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_batch uuid := ops.uuid_v7();
  v_url text;
  v_secret text;
begin
  insert into messaging.app_pushes (batch_id, user_id, kind, title, body, data, channel)
  select v_batch, x.u, p_kind, left(p_title, 80), left(coalesce(p_body, ''), 180), coalesce(p_data, '{}'::jsonb), p_channel
  from (select distinct unnest(p_users) as u) x
  where x.u is not null and x.u is distinct from (select auth.uid())
    and exists (select 1 from messaging.push_tokens t where t.user_id = x.u)
    and exists (select 1 from identity.profiles pr where pr.user_id = x.u and pr.account_status = 'active')
    and not messaging.in_quiet_hours(x.u);
  if not found then
    return;
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'push_function_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'push_function_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('app_batch', v_batch),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 10000
  );
end;
$$;

-- The Expo messages for one batch (only the push function, with the service role, calls this).
create or replace function api.app_push_batch(p_batch_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  with sent as (
    update messaging.app_pushes p set sent_at = now()
    where p.batch_id = p_batch_id and p.sent_at is null and p.created_at > now() - interval '10 minutes'
    returning p.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'to', t.token,
    'title', s.title,
    'body', s.body,
    'data', s.data || jsonb_build_object('kind', s.kind, 'badge', messaging.unread_total(s.user_id)),
    'badge', messaging.unread_total(s.user_id),
    'channelId', s.channel,
    'sound', 'default',
    'priority', 'high',
    'ttl', 86400
  )), '[]'::jsonb)
  into v_result
  from sent s
  join messaging.push_tokens t on t.user_id = s.user_id;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Hosting a kuppi for a request tells everyone who asked or voted
-- ---------------------------------------------------------------------------------------------

create or replace function kuppi.request_answered()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session kuppi.sessions;
begin
  select * into v_session from kuppi.sessions s where s.id = new.session_id;
  if v_session.id is null then
    return null;
  end if;
  perform messaging.notify(
    array(select v.user_id from kuppi.request_votes v where v.request_id = new.id
          union select new.requester_id),
    'kuppi_answered',
    'Your kuppi request was answered',
    split_part(coalesce((select p.full_name from identity.profiles p where p.user_id = v_session.host_id), 'A student'), ' ', 1)
      || ' is hosting ' || v_session.title || ' on '
      || to_char(v_session.starts_at at time zone 'Asia/Colombo', 'Dy DD Mon, FMHH12:MI am') || '.',
    jsonb_build_object('kuppi_id', v_session.id),
    'kuppi');
  return null;
end;
$$;

create trigger requests_answered after update of session_id on kuppi.requests
  for each row when (old.session_id is null and new.session_id is not null)
  execute function kuppi.request_answered();

-- ---------------------------------------------------------------------------------------------
-- Removing a request: only while nobody else wants it
-- ---------------------------------------------------------------------------------------------

create or replace function api.close_kuppi_request(p_request_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_request kuppi.requests;
begin
  select r.* into v_request from kuppi.requests r where r.id = p_request_id for update;
  if v_uid is null or v_request.id is null or not (select identity.is_active_user()) then
    raise exception 'That request is not available.' using errcode = 'P0002';
  end if;
  if identity.is_staff_for(v_request.institution_id) then
    null;
  elsif v_request.requester_id is distinct from v_uid then
    raise exception 'Only the student who asked can remove this.' using errcode = '42501';
  elsif exists (select 1 from kuppi.request_votes v where v.request_id = p_request_id and v.user_id <> v_uid) then
    raise exception 'Others want this too, so it stays until someone hosts a kuppi for it.' using errcode = '22023';
  end if;
  update kuppi.requests r set closed_at = coalesce(r.closed_at, now()) where r.id = p_request_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The list: open requests only (answered ones leave it), most wanted first
-- ---------------------------------------------------------------------------------------------

-- Open requests, most wanted first: at the caller's university, plus, for a module (and the
-- student's modules), ones asked of all universities on the same subject.
create or replace function api.kuppi_requests(p_scope text default 'my_modules', p_module_id bigint default null)
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
  v_modules bigint[] := '{}';
  v_subjects bigint[] := '{}';
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_scope not in ('my_modules', 'module', 'all') then
    raise exception 'Unknown list.' using errcode = '22023';
  end if;
  v_institution := (select identity.current_institution_id());
  if p_scope = 'module' then
    v_module := (content.my_module(p_module_id)).id;
    v_subjects := array_remove(array[academics.subject_of(v_module)], null);
  elsif p_scope = 'my_modules' then
    v_modules := coalesce((select array_agg(m.module_id) from content.my_modules_for(v_uid) m), '{}');
    v_subjects := kuppi.my_subjects(v_uid);
  end if;
  return coalesce((
    select jsonb_agg(kuppi.request_json(x.r, v_uid) order by x.votes desc, x.created_at desc)
    from (
      select r, r.votes, r.created_at from kuppi.requests r
      where r.closed_at is null
        and case p_scope
          when 'module' then r.module_id = v_module
            or (r.scope = 'national' and r.institution_id <> v_institution and academics.subject_of(r.module_id) = any (v_subjects))
          when 'my_modules' then (r.institution_id = v_institution and r.module_id = any (v_modules))
            or (r.scope = 'national' and r.institution_id <> v_institution and academics.subject_of(r.module_id) = any (v_subjects))
          else r.institution_id = v_institution
        end
      order by r.votes desc, r.created_at desc
      limit 50
    ) x), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------

revoke execute on function messaging.notify(uuid[], text, text, text, jsonb, text) from public, anon, authenticated;
revoke execute on function kuppi.request_answered() from public, anon, authenticated;
revoke execute on function api.app_push_batch(uuid) from public, anon, authenticated;
grant execute on function api.app_push_batch(uuid) to service_role;
