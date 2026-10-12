-- Exam dates and kuppi requests.
--
-- Exam dates: a batch's exams (finals, mids, quizzes, practicals, assignment deadlines) per module,
-- set once for everyone by a rep or moderator (or, in a batch with no reps yet, by any batchmate;
-- every change is audited and shows who set it). Students see "CS2012 exam in 12 days" and the app
-- puts that module's past papers first.
--
-- Kuppi requests: "I need help with AVL trees". Students ask for a kuppi on a topic and others add
-- their vote, so hosts see demand. Requests are anonymous to other students (the count matters, not
-- the names; asking for help should not be embarrassing); moderators can see who asked. A similar
-- open request in the same module gets the vote instead of a duplicate. Hosting a kuppi for a request
-- closes it and links the kuppi, so everyone who asked sees it.

-- ---------------------------------------------------------------------------------------------
-- Exams
-- ---------------------------------------------------------------------------------------------

create table academics.cohort_exams (
  id uuid primary key default ops.uuid_v7(),
  cohort_id bigint not null references academics.cohorts (id) on delete cascade,
  module_id bigint not null references academics.modules (id) on delete cascade,
  kind text not null default 'final' check (kind in ('final', 'mid', 'quiz', 'practical', 'deadline')),
  starts_at timestamptz not null,
  venue text check (char_length(venue) <= 160),
  set_by uuid references identity.profiles (user_id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (cohort_id, module_id, kind)
);
create index cohort_exams_cohort_time_idx on academics.cohort_exams (cohort_id, starts_at);
create index cohort_exams_module_idx on academics.cohort_exams (module_id);
create index cohort_exams_set_by_idx on academics.cohort_exams (set_by);
alter table academics.cohort_exams enable row level security;
-- No grants: through the api functions below.

-- Reps and moderators set exam dates; in a batch with no reps yet, any batchmate may.
create or replace function academics.can_set_exams(p_cohort_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select academics.can_edit_cohort(p_cohort_id)
    or (exists (select 1 from academics.cohort_members m where m.cohort_id = p_cohort_id and m.user_id = (select auth.uid()))
        and not exists (select 1 from messaging.conversations c
                        join messaging.conversation_members cm on cm.conversation_id = c.id and cm.role = 'admin'
                        where c.cohort_id = p_cohort_id));
$$;
revoke execute on function academics.can_set_exams(bigint) from public, anon, authenticated;

-- The caller's upcoming exams (from yesterday on) for the modules they take, soonest first.
create or replace function api.my_exams()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_c record;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v_c from academics.my_cohort();
  if v_c.id is null then
    return jsonb_build_object('exams', '[]'::jsonb, 'can_edit', false);
  end if;
  return jsonb_build_object(
    'can_edit', academics.can_set_exams(v_c.id),
    'exams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'kind', e.kind,
        'starts_at', e.starts_at,
        'venue', e.venue,
        'days', greatest(0, ceil(extract(epoch from e.starts_at - now()) / 86400))::integer,
        'set_by', (select p.full_name from identity.profiles p where p.user_id = e.set_by),
        'module', jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name)) order by e.starts_at)
      from academics.cohort_exams e
      join academics.modules m on m.id = e.module_id
      where e.cohort_id = v_c.id and e.starts_at > now() - interval '1 day'
        and e.module_id in (select x.module_id from content.my_modules_for(v_uid) x)), '[]'::jsonb));
end;
$$;
grant execute on function api.my_exams() to authenticated;

-- Sets (or moves) an exam for the batch. One per module and kind.
create or replace function api.set_exam(p_module_id bigint, p_kind text, p_starts_at timestamptz, p_venue text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_c record;
  v_module academics.modules;
  v_venue text := nullif(btrim(coalesce(p_venue, '')), '');
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v_c from academics.my_cohort();
  if v_c.id is null then
    raise exception 'Join your batch first.' using errcode = '22023';
  end if;
  if not academics.can_set_exams(v_c.id) then
    raise exception 'Batch reps set exam dates. Ask one of your reps.' using errcode = '42501';
  end if;
  v_module := content.my_module(p_module_id);
  if p_kind is null or p_kind not in ('final', 'mid', 'quiz', 'practical', 'deadline') then
    raise exception 'Choose what kind of exam it is.' using errcode = '22023';
  end if;
  if p_starts_at is null or p_starts_at < now() - interval '1 day' or p_starts_at > now() + interval '400 days' then
    raise exception 'Choose a date within the next year.' using errcode = '22023';
  end if;
  if v_venue is not null and char_length(v_venue) > 160 then
    raise exception 'Keep the venue under 160 characters.' using errcode = '22023';
  end if;
  perform messaging.hit_limit('set_exam', 50, 'You have changed a lot of exams today. Try again tomorrow.');

  insert into academics.cohort_exams as e (cohort_id, module_id, kind, starts_at, venue, set_by)
  values (v_c.id, v_module.id, p_kind, p_starts_at, v_venue, v_uid)
  on conflict (cohort_id, module_id, kind)
  do update set starts_at = excluded.starts_at, venue = excluded.venue, set_by = excluded.set_by, updated_at = now();
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_uid, 'exams.set', 'academics.cohort_exams', v_c.id::text,
          jsonb_build_object('module_id', v_module.id, 'kind', p_kind, 'starts_at', p_starts_at, 'venue', v_venue));
  return api.my_exams();
end;
$$;
grant execute on function api.set_exam(bigint, text, timestamptz, text) to authenticated;

create or replace function api.remove_exam(p_exam_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_c record;
  v_exam academics.cohort_exams;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v_c from academics.my_cohort();
  select e.* into v_exam from academics.cohort_exams e where e.id = p_exam_id and e.cohort_id = v_c.id;
  if v_exam.id is null then
    raise exception 'That exam is not available.' using errcode = 'P0002';
  end if;
  if not academics.can_set_exams(v_c.id) then
    raise exception 'Batch reps set exam dates. Ask one of your reps.' using errcode = '42501';
  end if;
  delete from academics.cohort_exams e where e.id = p_exam_id;
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_uid, 'exams.remove', 'academics.cohort_exams', v_c.id::text,
          jsonb_build_object('module_id', v_exam.module_id, 'kind', v_exam.kind, 'starts_at', v_exam.starts_at));
  return api.my_exams();
end;
$$;
grant execute on function api.remove_exam(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Kuppi requests
-- ---------------------------------------------------------------------------------------------

create table kuppi.requests (
  id uuid primary key default ops.uuid_v7(),
  module_id bigint not null references academics.modules (id) on delete cascade,
  institution_id bigint not null references identity.institutions (id) on delete cascade,
  requester_id uuid references identity.profiles (user_id) on delete set null,
  topic text not null check (char_length(btrim(topic)) between 3 and 120),
  details text check (char_length(details) <= 500),
  votes integer not null default 0 check (votes >= 0),
  session_id uuid references kuppi.sessions (id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index requests_open_idx on kuppi.requests (institution_id, module_id) where closed_at is null;
create index requests_module_idx on kuppi.requests (module_id);
create index requests_requester_idx on kuppi.requests (requester_id);
create index requests_session_idx on kuppi.requests (session_id);

create table kuppi.request_votes (
  request_id uuid not null references kuppi.requests (id) on delete cascade,
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);
create index request_votes_user_idx on kuppi.request_votes (user_id);

alter table kuppi.requests enable row level security;
alter table kuppi.request_votes enable row level security;

create or replace function kuppi.count_request_votes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update kuppi.requests r set votes = r.votes + 1 where r.id = new.request_id;
  else
    update kuppi.requests r set votes = greatest(r.votes - 1, 0) where r.id = old.request_id;
  end if;
  return null;
end;
$$;
revoke execute on function kuppi.count_request_votes() from public, anon, authenticated;
create trigger request_votes_count after insert or delete on kuppi.request_votes
  for each row execute function kuppi.count_request_votes();

-- What the app shows for a request (never who asked, except to the asker).
create or replace function kuppi.request_json(p_request kuppi.requests, p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_request.id,
    'topic', p_request.topic,
    'details', p_request.details,
    'votes', p_request.votes,
    'voted', exists (select 1 from kuppi.request_votes v where v.request_id = p_request.id and v.user_id = p_uid),
    'mine', p_request.requester_id = p_uid,
    'closed', p_request.closed_at is not null,
    'created_at', p_request.created_at,
    'module', (select jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name) from academics.modules m where m.id = p_request.module_id),
    'session', (select jsonb_build_object('id', s.id, 'title', s.title, 'starts_at', s.starts_at, 'cancelled', s.cancelled_at is not null)
                from kuppi.sessions s where s.id = p_request.session_id));
$$;
revoke execute on function kuppi.request_json(kuppi.requests, uuid) from public, anon, authenticated;

-- Asks for a kuppi. A similar open request in the module gets the caller's vote instead.
create or replace function api.request_kuppi(p_module_id bigint, p_topic text, p_details text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_module academics.modules;
  v_topic text := btrim(regexp_replace(coalesce(p_topic, ''), '\s+', ' ', 'g'));
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_request kuppi.requests;
  v_merged boolean := false;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v_module := content.my_module(p_module_id);
  if char_length(v_topic) not between 3 and 120 then
    raise exception 'Say what you need help with (3 to 120 characters).' using errcode = '22023';
  end if;
  if v_details is not null and char_length(v_details) > 500 then
    raise exception 'Keep the details under 500 characters.' using errcode = '22023';
  end if;

  select r.* into v_request from kuppi.requests r
  where r.module_id = v_module.id and r.closed_at is null
    and extensions.similarity(lower(r.topic), lower(v_topic)) >= 0.5
  order by extensions.similarity(lower(r.topic), lower(v_topic)) desc, r.votes desc
  limit 1;
  if v_request.id is not null then
    v_merged := true;
  else
    perform messaging.hit_limit('request_kuppi', 5, 'You have asked for a lot of kuppi today. Try again tomorrow.');
    insert into kuppi.requests (module_id, institution_id, requester_id, topic, details)
    values (v_module.id, v_module.institution_id, v_uid, v_topic, v_details)
    returning * into v_request;
  end if;
  insert into kuppi.request_votes (request_id, user_id) values (v_request.id, v_uid) on conflict do nothing;
  select r.* into v_request from kuppi.requests r where r.id = v_request.id;
  return kuppi.request_json(v_request, v_uid) || jsonb_build_object('merged', v_merged);
end;
$$;
grant execute on function api.request_kuppi(bigint, text, text) to authenticated;

-- Open requests at the caller's university (and ones answered in the last 14 days), most wanted first.
--   'my_modules' | 'module' (p_module_id) | 'all'
create or replace function api.kuppi_requests(p_scope text default 'my_modules', p_module_id bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_module bigint;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_scope not in ('my_modules', 'module', 'all') then
    raise exception 'Unknown list.' using errcode = '22023';
  end if;
  if p_scope = 'module' then
    v_module := (content.my_module(p_module_id)).id;
  end if;
  return coalesce((
    select jsonb_agg(kuppi.request_json(x.r, v_uid) order by x.answered, x.votes desc, x.created_at desc)
    from (
      select r, r.session_id is not null as answered, r.votes, r.created_at from kuppi.requests r
      where r.institution_id = (select identity.current_institution_id())
        and (r.closed_at is null or (r.session_id is not null and r.closed_at > now() - interval '14 days'))
        and case p_scope
          when 'module' then r.module_id = v_module
          when 'my_modules' then r.module_id in (select m.module_id from content.my_modules_for(v_uid) m)
          else true
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
  select r.* into v_request from kuppi.requests r
  where r.id = p_request_id and r.institution_id = (select identity.current_institution_id()) and r.closed_at is null;
  if v_request.id is null then
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

-- Closes a request: the student who asked, or the university's moderators.
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
  select r.* into v_request from kuppi.requests r where r.id = p_request_id;
  if v_uid is null or v_request.id is null or not (select identity.is_active_user()) then
    raise exception 'That request is not available.' using errcode = 'P0002';
  end if;
  if v_request.requester_id is distinct from v_uid and not identity.is_staff_for(v_request.institution_id) then
    raise exception 'Only the student who asked can close this.' using errcode = '42501';
  end if;
  update kuppi.requests r set closed_at = coalesce(r.closed_at, now()) where r.id = p_request_id;
end;
$$;
grant execute on function api.close_kuppi_request(uuid) to authenticated;

-- Requests are things students write, so they can be reported too.
alter table safety.reports drop constraint if exists reports_target_kind_check;
alter table safety.reports add constraint reports_target_kind_check
  check (target_kind in ('profile', 'message', 'resource', 'kuppi', 'conversation', 'kuppi_request', 'comment'));

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
  select r.* into v_request from kuppi.requests r
  where r.id = p_request_id and r.institution_id = (select identity.current_institution_id());
  if v_request.id is null then
    raise exception 'That request is not available.' using errcode = 'P0002';
  end if;
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
-- Hosting a kuppi can answer a request (p_request_id): the request closes and links the kuppi.
-- ---------------------------------------------------------------------------------------------

drop function api.create_kuppi(bigint, text, timestamptz, integer, text, integer, text, text, text);

-- Hosts a kuppi. p_minutes: 15 minutes to 6 hours. Online kuppi need a Zoom, Meet or Teams link;
-- in-person kuppi need a venue. Up to 5 a day and 10 upcoming per host. p_request_id: the kuppi
-- request this answers (it closes and links the kuppi).
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
  p_request_id uuid default null
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
  v_platform text;
  v_session kuppi.sessions;
  v_chat uuid;
  v_request uuid;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v_module := content.my_module(p_module_id);
  if p_request_id is not null then
    select r.id into v_request from kuppi.requests r
    where r.id = p_request_id and r.module_id = v_module.id and r.closed_at is null;
    if v_request is null then
      raise exception 'That request is no longer open for this module.' using errcode = '22023';
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
    platform, capacity)
  values (v_uid, v_module.id, v_module.institution_id, v_title, v_description, p_starts_at,
    p_starts_at + make_interval(mins => p_minutes), p_mode, v_venue, v_platform, p_capacity)
  returning * into v_session;
  if v_url is not null then
    insert into kuppi.session_links (session_id, meeting_url) values (v_session.id, v_url);
  end if;
  if v_request is not null then
    update kuppi.requests r set session_id = v_session.id, closed_at = now() where r.id = v_request;
  end if;

  insert into messaging.conversations (kind, session_id, title, created_by)
  values ('kuppi', v_session.id, left('Kuppi · ' || v_module.code || ' · ' || v_title, 80), v_uid)
  returning id into v_chat;
  insert into messaging.conversation_members (conversation_id, user_id, role) values (v_chat, v_uid, 'admin');
  perform messaging.tell_users(array[v_uid], 'chats', jsonb_build_object('conversation_id', v_chat));

  return kuppi.session_json(v_session, v_uid);
end;
$$;
grant execute on function api.create_kuppi(bigint, text, timestamptz, integer, text, integer, text, text, text, uuid) to authenticated;
