-- Kuppi across universities. A kuppi request can reach students at every university taking the same
-- national subject (anonymous as before: other students see the university, never who asked), and an
-- online kuppi can be open to all universities. A host at another university answers a request with
-- an online kuppi open to everyone, so the students who asked can join it.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- A module's national subject (following merges), or null.
create or replace function academics.subject_of(p_module_id bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.merged_into_id, s.id)
  from academics.modules m join academics.subjects s on s.id = m.subject_id
  where m.id = p_module_id;
$$;
revoke execute on function academics.subject_of(bigint) from public, anon, authenticated;

-- The national subjects of the modules a student takes or took.
create or replace function kuppi.my_subjects(p_uid uuid)
returns bigint[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.subject) filter (where x.subject is not null), '{}')
  from (select academics.subject_of(m.module_id) as subject from content.my_modules_for(p_uid) m) x;
$$;
revoke execute on function kuppi.my_subjects(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Scope columns
-- ---------------------------------------------------------------------------------------------

alter table kuppi.requests
  add column scope text not null default 'university' check (scope in ('university', 'national'));
create index requests_national_idx on kuppi.requests (created_at) where scope = 'national';

-- A kuppi open to all universities is online: nobody travels to another campus for a session
-- arranged with strangers.
alter table kuppi.sessions
  add column scope text not null default 'university' check (scope in ('university', 'national')),
  add constraint sessions_national_online check (scope = 'university' or mode = 'online');
create index sessions_national_upcoming_idx on kuppi.sessions (starts_at) where scope = 'national' and cancelled_at is null;

-- ---------------------------------------------------------------------------------------------
-- Kuppi sessions
-- ---------------------------------------------------------------------------------------------

create or replace function kuppi.session_json(p_session kuppi.sessions, p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_session.id,
    'title', p_session.title,
    'description', p_session.description,
    'starts_at', p_session.starts_at,
    'ends_at', p_session.ends_at,
    'link_opens_at', p_session.starts_at - interval '15 minutes',
    'mode', p_session.mode,
    'venue', p_session.venue,
    'platform', p_session.platform,
    'capacity', p_session.capacity,
    'going', p_session.rsvp_count,
    'full', p_session.rsvp_count >= p_session.capacity,
    'cancelled', p_session.cancelled_at is not null,
    'cancel_reason', p_session.cancel_reason,
    'hosting', p_session.host_id = p_uid,
    'rsvped', exists (select 1 from kuppi.rsvps r where r.session_id = p_session.id and r.user_id = p_uid),
    'scope', p_session.scope,
    'other', p_session.institution_id is distinct from (select p.institution_id from identity.profiles p where p.user_id = p_uid),
    'institution', (select coalesce(i.short_name, i.name) from identity.institutions i where i.id = p_session.institution_id),
    'host', (select jsonb_build_object('id', p.user_id, 'name', p.full_name, 'avatar_path', p.avatar_path)
             from identity.profiles p where p.user_id = p_session.host_id),
    'module', (select jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name)
               from academics.modules m where m.id = p_session.module_id),
    'chat_id', (select c.id from messaging.conversations c
                join messaging.conversation_members cm on cm.conversation_id = c.id and cm.user_id = p_uid
                where c.session_id = p_session.id));
$$;
revoke execute on function kuppi.session_json(kuppi.sessions, uuid) from public, anon, authenticated;

-- A kuppi the caller may see: at their university or open to all universities, and not hosted by
-- someone they blocked or who blocked them.
create or replace function kuppi.visible_session(p_id uuid)
returns kuppi.sessions
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session kuppi.sessions;
  v_uid uuid := (select auth.uid());
begin
  select s.* into v_session from kuppi.sessions s
  where s.id = p_id and (s.institution_id = (select identity.current_institution_id()) or s.scope = 'national')
    and not exists (select 1 from safety.blocks b
                    where (b.blocker_id = v_uid and b.blocked_id = s.host_id) or (b.blocker_id = s.host_id and b.blocked_id = v_uid));
  if v_session.id is null then
    raise exception 'That kuppi is not available.' using errcode = 'P0002';
  end if;
  return v_session;
end;
$$;
revoke execute on function kuppi.visible_session(uuid) from public, anon, authenticated;

-- Upcoming kuppi. For a module (and the student's modules), kuppi open to all universities on the
-- same subject come too.
--   'my_modules'  for the modules the student takes or took
--   'module'      for one module (p_module_id)
--   'mine'        hosting or going (cancelled ones too, so attendees see the news)
--   'all'         everything at the university
create or replace function api.kuppi_list(
  p_scope text default 'all',
  p_module_id bigint default null,
  p_after timestamptz default null,
  p_limit integer default 30
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
  v_modules bigint[] := '{}';
  v_subjects bigint[] := '{}';
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_scope not in ('my_modules', 'module', 'mine', 'all') then
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
    select jsonb_agg(kuppi.session_json(x.session, v_uid) order by x.starts_at, x.id)
    from (
      select s as session, s.starts_at, s.id from kuppi.sessions s
      where s.ends_at > now()
        and (p_after is null or s.starts_at > p_after)
        and (s.cancelled_at is null or p_scope = 'mine')
        and case p_scope
          when 'module' then s.module_id = v_module
            or (s.scope = 'national' and s.institution_id <> v_institution and academics.subject_of(s.module_id) = any (v_subjects))
          when 'my_modules' then (s.institution_id = v_institution and s.module_id = any (v_modules))
            or (s.scope = 'national' and s.institution_id <> v_institution and academics.subject_of(s.module_id) = any (v_subjects))
          when 'mine' then s.host_id = v_uid or exists (select 1 from kuppi.rsvps r where r.session_id = s.id and r.user_id = v_uid)
          else s.institution_id = v_institution
        end
        and not exists (select 1 from safety.blocks b
                        where (b.blocker_id = v_uid and b.blocked_id = s.host_id) or (b.blocker_id = s.host_id and b.blocked_id = v_uid))
      order by s.starts_at, s.id
      limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) x), '[]'::jsonb);
end;
$$;
grant execute on function api.kuppi_list(text, bigint, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Kuppi requests
-- ---------------------------------------------------------------------------------------------

-- What the app shows for a request (never who asked, except to the asker). other: asked at another
-- university; host_module_id: the caller's module to host an answering kuppi under; session: the
-- kuppi that answered it, when the caller may join it (answered says it was answered either way).
create or replace function kuppi.request_json(p_request kuppi.requests, p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.institution_id from identity.profiles p where p.user_id = p_uid
  ), x as (
    select p_request.institution_id is distinct from (select me.institution_id from me) as other
  )
  select jsonb_build_object(
    'id', p_request.id,
    'topic', p_request.topic,
    'details', p_request.details,
    'votes', p_request.votes,
    'voted', exists (select 1 from kuppi.request_votes v where v.request_id = p_request.id and v.user_id = p_uid),
    'mine', p_request.requester_id = p_uid,
    'closed', p_request.closed_at is not null,
    'answered', p_request.session_id is not null,
    'created_at', p_request.created_at,
    'scope', p_request.scope,
    'other', x.other,
    'institution', (select coalesce(i.short_name, i.name) from identity.institutions i where i.id = p_request.institution_id),
    'universities', case when p_request.scope = 'national' then
      (select count(distinct p.institution_id) from kuppi.request_votes v join identity.profiles p on p.user_id = v.user_id
       where v.request_id = p_request.id) end,
    'module', (select jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name) from academics.modules m where m.id = p_request.module_id),
    'host_module_id', case when not x.other then p_request.module_id else
      (select m.module_id from content.my_modules_for(p_uid) m
       where academics.subject_of(m.module_id) = academics.subject_of(p_request.module_id)
       order by m.is_current desc, m.module_id limit 1) end,
    'session', (select jsonb_build_object('id', s.id, 'title', s.title, 'starts_at', s.starts_at, 'cancelled', s.cancelled_at is not null)
                from kuppi.sessions s
                where s.id = p_request.session_id
                  and (s.scope = 'national' or s.institution_id = (select me.institution_id from me))))
  from x;
$$;
revoke execute on function kuppi.request_json(kuppi.requests, uuid) from public, anon, authenticated;

-- A request the caller may see: at their university, or asked of all universities for a subject
-- they take.
create or replace function kuppi.visible_request(p_id uuid)
returns kuppi.requests
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_request kuppi.requests;
  v_uid uuid := (select auth.uid());
begin
  select r.* into v_request from kuppi.requests r where r.id = p_id;
  if v_request.id is null
     or (v_request.institution_id is distinct from (select identity.current_institution_id())
         and not (v_request.scope = 'national' and academics.subject_of(v_request.module_id) = any (kuppi.my_subjects(v_uid)))) then
    raise exception 'That request is not available.' using errcode = 'P0002';
  end if;
  return v_request;
end;
$$;
revoke execute on function kuppi.visible_request(uuid) from public, anon, authenticated;

-- Asks for a kuppi; p_scope 'national' asks every university teaching the subject. A similar open
-- request (in the module, or asked of all universities for the subject) gets the caller's vote instead.
drop function api.request_kuppi(bigint, text, text);
create or replace function api.request_kuppi(p_module_id bigint, p_topic text, p_details text default null, p_scope text default 'university')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_module academics.modules;
  v_subject bigint;
  v_topic text := btrim(regexp_replace(coalesce(p_topic, ''), '\s+', ' ', 'g'));
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_request kuppi.requests;
  v_merged boolean := false;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v_module := content.my_module(p_module_id);
  v_subject := academics.subject_of(v_module.id);
  if p_scope is null or p_scope not in ('university', 'national') then
    raise exception 'Choose who can see the request.' using errcode = '22023';
  end if;
  if char_length(v_topic) not between 3 and 120 then
    raise exception 'Say what you need help with (3 to 120 characters).' using errcode = '22023';
  end if;
  if v_details is not null and char_length(v_details) > 500 then
    raise exception 'Keep the details under 500 characters.' using errcode = '22023';
  end if;

  select r.* into v_request from kuppi.requests r
  where r.closed_at is null
    and (r.module_id = v_module.id
         or (r.scope = 'national' and v_subject is not null and academics.subject_of(r.module_id) = v_subject))
    and extensions.similarity(lower(r.topic), lower(v_topic)) >= 0.5
  order by r.module_id = v_module.id desc, extensions.similarity(lower(r.topic), lower(v_topic)) desc, r.votes desc
  limit 1;
  if v_request.id is not null then
    v_merged := true;
  else
    perform messaging.hit_limit('request_kuppi', 5, 'You have asked for a lot of kuppi today. Try again tomorrow.');
    insert into kuppi.requests (module_id, institution_id, requester_id, topic, details, scope)
    values (v_module.id, v_module.institution_id, v_uid, v_topic, v_details, p_scope)
    returning * into v_request;
  end if;
  insert into kuppi.request_votes (request_id, user_id) values (v_request.id, v_uid) on conflict do nothing;
  select r.* into v_request from kuppi.requests r where r.id = v_request.id;
  return kuppi.request_json(v_request, v_uid) || jsonb_build_object('merged', v_merged);
end;
$$;
grant execute on function api.request_kuppi(bigint, text, text, text) to authenticated;

-- Open requests (and ones answered in the last 14 days), most wanted first: at the caller's
-- university, plus, for a module (and the student's modules), ones asked of all universities on the
-- same subject.
--   'my_modules' | 'module' (p_module_id) | 'all' (the caller's university)
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
    select jsonb_agg(kuppi.request_json(x.r, v_uid) order by x.answered, x.votes desc, x.created_at desc)
    from (
      select r, r.session_id is not null as answered, r.votes, r.created_at from kuppi.requests r
      where (r.closed_at is null or (r.session_id is not null and r.closed_at > now() - interval '14 days'))
        and case p_scope
          when 'module' then r.module_id = v_module
            or (r.scope = 'national' and r.institution_id <> v_institution and academics.subject_of(r.module_id) = any (v_subjects))
          when 'my_modules' then (r.institution_id = v_institution and r.module_id = any (v_modules))
            or (r.scope = 'national' and r.institution_id <> v_institution and academics.subject_of(r.module_id) = any (v_subjects))
          else r.institution_id = v_institution
        end
      order by r.session_id is not null, r.votes desc, r.created_at desc
      limit 50
    ) x), '[]'::jsonb);
end;
$$;
grant execute on function api.kuppi_requests(text, bigint) to authenticated;

create or replace function api.vote_kuppi_request(p_request_id uuid, p_on boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_request kuppi.requests;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v_request := kuppi.visible_request(p_request_id);
  if v_request.closed_at is not null then
    raise exception 'That request is not open.' using errcode = 'P0002';
  end if;
  if p_on then
    perform messaging.hit_limit('vote_request', 200, 'You have voted a lot today. Try again tomorrow.');
    insert into kuppi.request_votes (request_id, user_id) values (p_request_id, v_uid) on conflict do nothing;
  else
    delete from kuppi.request_votes v where v.request_id = p_request_id and v.user_id = v_uid;
  end if;
  select r.* into v_request from kuppi.requests r where r.id = p_request_id;
  return kuppi.request_json(v_request, v_uid);
end;
$$;
grant execute on function api.vote_kuppi_request(uuid, boolean) to authenticated;

-- Reports go to the moderators of the university where it was asked.
create or replace function api.report_kuppi_request(p_request_id uuid, p_category text, p_details text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_request kuppi.requests;
  v_id uuid;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v_request := kuppi.visible_request(p_request_id);
  if not exists (select 1 from safety.report_categories rc where rc.code = p_category) then
    raise exception 'Choose what is wrong.' using errcode = '22023';
  end if;
  select r.id into v_id from safety.reports r
  where r.reporter_id = v_uid and r.target_kind = 'kuppi_request' and r.target_id = p_request_id::text and r.status = 'open';
  if v_id is not null then
    return v_id;
  end if;
  perform messaging.hit_limit('report', 20, 'You have sent a lot of reports today. Our team will look at them first.');
  insert into safety.reports (reporter_id, institution_id, target_kind, target_id, category_code, details, snapshot)
  values (v_uid, v_request.institution_id, 'kuppi_request', p_request_id::text, p_category,
          nullif(btrim(coalesce(p_details, '')), ''),
          kuppi.request_json(v_request, v_uid) || jsonb_build_object('requester_id', v_request.requester_id))
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function api.report_kuppi_request(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Hosting: p_scope 'national' opens an online kuppi to all universities on the subject. Answering a
-- request asked at another university always does, so the students who asked can join.
-- ---------------------------------------------------------------------------------------------

drop function api.create_kuppi(bigint, text, timestamptz, integer, text, integer, text, text, text, uuid);

create or replace function api.create_kuppi(
  p_module_id bigint,
  p_title text,
  p_starts_at timestamptz,
  p_minutes integer,
  p_mode text,
  p_capacity integer,
  p_meeting_url text default null,
  p_venue text default null,
  p_description text default null,
  p_request_id uuid default null,
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
  v_title text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_venue text := nullif(btrim(regexp_replace(coalesce(p_venue, ''), '\s+', ' ', 'g')), '');
  v_url text := nullif(btrim(coalesce(p_meeting_url, '')), '');
  v_scope text := p_scope;
  v_platform text;
  v_session kuppi.sessions;
  v_chat uuid;
  v_request kuppi.requests;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v_module := content.my_module(p_module_id);
  if v_scope is null or v_scope not in ('university', 'national') then
    raise exception 'Choose who can join.' using errcode = '22023';
  end if;
  if p_request_id is not null then
    select r.* into v_request from kuppi.requests r
    where r.id = p_request_id and r.closed_at is null
      and (r.module_id = v_module.id
           or (r.scope = 'national' and academics.subject_of(r.module_id) = academics.subject_of(v_module.id)));
    if v_request.id is null then
      raise exception 'That request is no longer open for this module.' using errcode = '22023';
    end if;
    if v_request.institution_id <> v_module.institution_id then
      v_scope := 'national';
    end if;
  end if;
  if char_length(v_title) not between 3 and 120 then
    raise exception 'Give the kuppi a topic (3 to 120 characters).' using errcode = '22023';
  end if;
  if v_description is not null and char_length(v_description) > 1000 then
    raise exception 'Keep the description under 1,000 characters.' using errcode = '22023';
  end if;
  if p_starts_at is null or p_starts_at < now() + interval '5 minutes' or p_starts_at > now() + interval '120 days' then
    raise exception 'Choose a start time from 5 minutes to 4 months from now.' using errcode = '22023';
  end if;
  if p_minutes is null or p_minutes not between 15 and 360 then
    raise exception 'A kuppi is 15 minutes to 6 hours long.' using errcode = '22023';
  end if;
  if p_capacity is null or p_capacity not between 2 and 1000 then
    raise exception 'Capacity is 2 to 1,000 students.' using errcode = '22023';
  end if;
  if v_scope = 'national' and p_mode is distinct from 'online' then
    raise exception 'A kuppi for students at other universities is online. Add a Zoom, Meet or Teams link.' using errcode = '22023';
  end if;
  if p_mode = 'online' then
    v_platform := kuppi.meeting_platform(v_url);
    if v_platform is null or char_length(v_url) > 500 then
      raise exception 'Paste a Zoom, Google Meet or Microsoft Teams link (starting with https://).' using errcode = '22023';
    end if;
    v_venue := null;
  elsif p_mode = 'in_person' then
    if v_venue is null or char_length(v_venue) not between 2 and 160 then
      raise exception 'Add where the kuppi is held.' using errcode = '22023';
    end if;
    v_url := null;
  else
    raise exception 'A kuppi is online or in person.' using errcode = '22023';
  end if;
  if (select count(*) from kuppi.sessions s
      where s.host_id = v_uid and s.cancelled_at is null and s.ends_at > now()) >= 10 then
    raise exception 'You are hosting 10 upcoming kuppi. Hold some before adding more.' using errcode = '22023';
  end if;
  perform messaging.hit_limit('create_kuppi', 5, 'You have created a lot of kuppi today. Try again tomorrow.');

  insert into kuppi.sessions (host_id, module_id, institution_id, title, description, starts_at, ends_at, mode, venue,
    platform, capacity, scope)
  values (v_uid, v_module.id, v_module.institution_id, v_title, v_description, p_starts_at,
    p_starts_at + make_interval(mins => p_minutes), p_mode, v_venue, v_platform, p_capacity, v_scope)
  returning * into v_session;
  if v_url is not null then
    insert into kuppi.session_links (session_id, meeting_url) values (v_session.id, v_url);
  end if;
  if v_request.id is not null then
    update kuppi.requests r set session_id = v_session.id, closed_at = now() where r.id = v_request.id;
  end if;

  insert into messaging.conversations (kind, session_id, title, created_by)
  values ('kuppi', v_session.id, left('Kuppi · ' || v_module.code || ' · ' || v_title, 80), v_uid)
  returning id into v_chat;
  insert into messaging.conversation_members (conversation_id, user_id, role) values (v_chat, v_uid, 'admin');
  perform messaging.tell_users(array[v_uid], 'chats', jsonb_build_object('conversation_id', v_chat));

  return kuppi.session_json(v_session, v_uid);
end;
$$;
grant execute on function api.create_kuppi(bigint, text, timestamptz, integer, text, integer, text, text, text, uuid, text) to authenticated;
