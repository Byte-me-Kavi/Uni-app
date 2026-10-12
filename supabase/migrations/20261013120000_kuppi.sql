-- Kuppi: peer tutoring sessions held on Zoom, Google Meet or Teams (or in person), listed in
-- Resources and on each module.
--
--   * A student hosts a kuppi for a module at their university: topic, time, length, capacity, and
--     a Zoom / Meet / Teams link (checked) or a venue.
--   * Students at the same university RSVP. Capacity is enforced here, in one transaction with a
--     lock on the session, so two last-second RSVPs cannot both take the last seat.
--   * The meeting link is never readable directly (kuppi.session_links has no grants).
--     api.reveal_link gives it only to the host and to students who RSVP'd, from 15 minutes before
--     the start until 30 minutes after the end, so links do not leak into public chats early.
--   * Each kuppi has a chat: the host and everyone who RSVP'd. RSVPing adds a student, cancelling
--     removes them. Files shared there file themselves into the module's library.
--   * Hosts (or moderators) can cancel; students can report a kuppi.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

alter table kuppi.sessions
  -- Listing a university's upcoming kuppi without visiting every module.
  add column institution_id bigint references identity.institutions (id) on delete cascade,
  add column platform text check (platform in ('zoom', 'meet', 'teams')),
  add column rsvp_count integer not null default 0 check (rsvp_count >= 0),
  add column cancel_reason text check (char_length(cancel_reason) <= 300);
update kuppi.sessions s set institution_id = m.institution_id from academics.modules m where m.id = s.module_id;
alter table kuppi.sessions alter column institution_id set not null;
alter table kuppi.sessions add constraint sessions_online_platform check (mode = 'in_person' or platform is not null);
create index sessions_institution_upcoming_idx on kuppi.sessions (institution_id, starts_at) where cancelled_at is null;

-- Students read kuppi only through the api functions below (which apply blocks and capacity).
revoke select on kuppi.sessions, kuppi.rsvps from authenticated;

create or replace function kuppi.count_rsvps()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update kuppi.sessions s set rsvp_count = s.rsvp_count + 1 where s.id = new.session_id;
  else
    update kuppi.sessions s set rsvp_count = greatest(s.rsvp_count - 1, 0) where s.id = old.session_id;
  end if;
  return null;
end;
$$;
revoke execute on function kuppi.count_rsvps() from public, anon, authenticated;
create trigger rsvps_count after insert or delete on kuppi.rsvps
  for each row execute function kuppi.count_rsvps();

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- Which meeting service a link is for; null for anything else (refused).
create or replace function kuppi.meeting_platform(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_url ~* '^https://([a-z0-9-]+\.)*zoom\.(us|com)/[^\s]*$' then 'zoom'
    when p_url ~* '^https://meet\.google\.com/[^\s]*$' then 'meet'
    when p_url ~* '^https://(teams\.microsoft\.com|teams\.live\.com)/[^\s]*$' then 'teams'
  end;
$$;
grant execute on function kuppi.meeting_platform(text) to authenticated, service_role;

-- What the app shows for a kuppi, for one student.
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
    'host', (select jsonb_build_object('id', p.user_id, 'name', p.full_name, 'avatar_path', p.avatar_path)
             from identity.profiles p where p.user_id = p_session.host_id),
    'module', (select jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name)
               from academics.modules m where m.id = p_session.module_id),
    'chat_id', (select c.id from messaging.conversations c
                join messaging.conversation_members cm on cm.conversation_id = c.id and cm.user_id = p_uid
                where c.session_id = p_session.id));
$$;
revoke execute on function kuppi.session_json(kuppi.sessions, uuid) from public, anon, authenticated;

-- A kuppi the caller may see: at their university, and not hosted by someone they blocked or who
-- blocked them. Locked for update when p_lock (RSVP).
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
  where s.id = p_id and s.institution_id = (select identity.current_institution_id())
    and not exists (select 1 from safety.blocks b
                    where (b.blocker_id = v_uid and b.blocked_id = s.host_id) or (b.blocker_id = s.host_id and b.blocked_id = v_uid));
  if v_session.id is null then
    raise exception 'That kuppi is not available.' using errcode = 'P0002';
  end if;
  return v_session;
end;
$$;
revoke execute on function kuppi.visible_session(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- api
-- ---------------------------------------------------------------------------------------------

-- Hosts a kuppi. p_minutes: 15 minutes to 6 hours. Online kuppi need a Zoom, Meet or Teams link;
-- in-person kuppi need a venue. Up to 5 a day and 10 upcoming per host.
create or replace function api.create_kuppi(
  p_module_id bigint,
  p_title text,
  p_starts_at timestamptz,
  p_minutes integer,
  p_mode text,
  p_capacity integer,
  p_meeting_url text default null,
  p_venue text default null,
  p_description text default null
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
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v_module := content.my_module(p_module_id);
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

  insert into messaging.conversations (kind, session_id, title, created_by)
  values ('kuppi', v_session.id, left('Kuppi · ' || v_module.code || ' · ' || v_title, 80), v_uid)
  returning id into v_chat;
  insert into messaging.conversation_members (conversation_id, user_id, role) values (v_chat, v_uid, 'admin');
  perform messaging.tell_users(array[v_uid], 'chats', jsonb_build_object('conversation_id', v_chat));

  return kuppi.session_json(v_session, v_uid);
end;
$$;
grant execute on function api.create_kuppi(bigint, text, timestamptz, integer, text, integer, text, text, text) to authenticated;

-- Upcoming kuppi at the caller's university, soonest first (p_after: the last starts_at seen).
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
  end if;

  return coalesce((
    select jsonb_agg(kuppi.session_json(x.session, v_uid) order by x.starts_at, x.id)
    from (
      select s as session, s.starts_at, s.id from kuppi.sessions s
      where s.institution_id = v_institution
        and s.ends_at > now()
        and (p_after is null or s.starts_at > p_after)
        and (s.cancelled_at is null or p_scope = 'mine')
        and case p_scope
          when 'module' then s.module_id = v_module
          when 'my_modules' then s.module_id in (select m.module_id from content.my_modules_for(v_uid) m)
          when 'mine' then s.host_id = v_uid or exists (select 1 from kuppi.rsvps r where r.session_id = s.id and r.user_id = v_uid)
          else true
        end
        and not exists (select 1 from safety.blocks b
                        where (b.blocker_id = v_uid and b.blocked_id = s.host_id) or (b.blocker_id = s.host_id and b.blocked_id = v_uid))
      order by s.starts_at, s.id
      limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) x), '[]'::jsonb);
end;
$$;
grant execute on function api.kuppi_list(text, bigint, timestamptz, integer) to authenticated;

create or replace function api.kuppi(p_session_id uuid)
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
  return kuppi.session_json(kuppi.visible_session(p_session_id), v_uid);
end;
$$;
grant execute on function api.kuppi(uuid) to authenticated;

-- RSVPs the caller and adds them to the kuppi's chat. Refused when full, cancelled or over.
create or replace function api.rsvp(p_session_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session kuppi.sessions;
  v_chat uuid;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  perform kuppi.visible_session(p_session_id);
  -- The lock makes the capacity check and the insert one step for everyone RSVPing at once.
  select s.* into v_session from kuppi.sessions s where s.id = p_session_id for update;
  if v_session.cancelled_at is not null then
    raise exception 'This kuppi was cancelled.' using errcode = '22023';
  end if;
  if v_session.ends_at <= now() then
    raise exception 'This kuppi is over.' using errcode = '22023';
  end if;
  if v_session.host_id = v_uid then
    raise exception 'You are hosting this kuppi.' using errcode = '22023';
  end if;
  if exists (select 1 from kuppi.rsvps r where r.session_id = p_session_id and r.user_id = v_uid) then
    return kuppi.session_json(v_session, v_uid);
  end if;
  if v_session.rsvp_count >= v_session.capacity then
    raise exception 'This kuppi is full.' using errcode = '22023';
  end if;
  perform messaging.hit_limit('rsvp', 50, 'You have RSVPed a lot today. Try again tomorrow.');

  insert into kuppi.rsvps (session_id, user_id) values (p_session_id, v_uid);
  select c.id into v_chat from messaging.conversations c where c.session_id = p_session_id;
  if v_chat is not null then
    insert into messaging.conversation_members (conversation_id, user_id) values (v_chat, v_uid) on conflict do nothing;
    perform messaging.tell_users(array[v_uid], 'chats', jsonb_build_object('conversation_id', v_chat));
  end if;
  select s.* into v_session from kuppi.sessions s where s.id = p_session_id;
  return kuppi.session_json(v_session, v_uid);
end;
$$;
grant execute on function api.rsvp(uuid) to authenticated;

-- Cancels the caller's RSVP and takes them out of the kuppi's chat (the seat frees up).
create or replace function api.cancel_rsvp(p_session_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session kuppi.sessions;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select s.* into v_session from kuppi.sessions s where s.id = p_session_id;
  if v_session.id is null then
    raise exception 'That kuppi is not available.' using errcode = 'P0002';
  end if;
  delete from kuppi.rsvps r where r.session_id = p_session_id and r.user_id = v_uid;
  if found and v_session.host_id <> v_uid then
    delete from messaging.conversation_members cm
    using messaging.conversations c
    where cm.conversation_id = c.id and c.session_id = p_session_id and cm.user_id = v_uid;
    perform messaging.tell_users(array[v_uid], 'chats', jsonb_build_object('session_id', p_session_id));
  end if;
  select s.* into v_session from kuppi.sessions s where s.id = p_session_id;
  return kuppi.session_json(v_session, v_uid);
end;
$$;
grant execute on function api.cancel_rsvp(uuid) to authenticated;

-- The meeting link: for the host at any time; for students who RSVP'd, from 15 minutes before the
-- start until 30 minutes after the end.
create or replace function api.reveal_link(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session kuppi.sessions;
  v_url text;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v_session := kuppi.visible_session(p_session_id);
  if v_session.cancelled_at is not null then
    raise exception 'This kuppi was cancelled.' using errcode = '22023';
  end if;
  if v_session.mode <> 'online' then
    raise exception 'This kuppi is in person: %.', v_session.venue using errcode = '22023';
  end if;
  if v_session.host_id <> v_uid then
    if not exists (select 1 from kuppi.rsvps r where r.session_id = p_session_id and r.user_id = v_uid) then
      raise exception 'RSVP to get the link.' using errcode = '42501';
    end if;
    if now() < v_session.starts_at - interval '15 minutes' then
      raise exception 'The link opens 15 minutes before the start.' using errcode = '22023';
    end if;
    if now() > v_session.ends_at + interval '30 minutes' then
      raise exception 'This kuppi is over.' using errcode = '22023';
    end if;
  end if;
  select l.meeting_url into v_url from kuppi.session_links l where l.session_id = p_session_id;
  return jsonb_build_object('url', v_url, 'platform', v_session.platform);
end;
$$;
grant execute on function api.reveal_link(uuid) to authenticated;

-- Cancels a kuppi: its host, or the university's moderators (audited). Everyone going keeps the
-- chat, where the host can explain.
create or replace function api.cancel_kuppi(p_session_id uuid, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session kuppi.sessions;
  v_staff boolean;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select s.* into v_session from kuppi.sessions s where s.id = p_session_id for update;
  if v_session.id is null then
    raise exception 'That kuppi is not available.' using errcode = 'P0002';
  end if;
  v_staff := identity.is_staff_for(v_session.institution_id);
  if v_session.host_id <> v_uid and not v_staff then
    raise exception 'Only the host can cancel this kuppi.' using errcode = '42501';
  end if;
  if p_reason is not null and char_length(p_reason) > 300 then
    raise exception 'Keep the reason under 300 characters.' using errcode = '22023';
  end if;
  if v_session.cancelled_at is null then
    update kuppi.sessions s set cancelled_at = now(), cancel_reason = nullif(btrim(coalesce(p_reason, '')), '')
    where s.id = p_session_id;
    if v_session.host_id <> v_uid then
      insert into ops.audit_log (actor_id, action, target_table, target_id, details)
      values (v_uid, 'kuppi.cancel', 'kuppi.sessions', p_session_id::text, jsonb_build_object('reason', p_reason));
    end if;
  end if;
  select s.* into v_session from kuppi.sessions s where s.id = p_session_id;
  return kuppi.session_json(v_session, v_uid);
end;
$$;
grant execute on function api.cancel_kuppi(uuid, text) to authenticated;

-- Reports a kuppi to the university's moderators, with a copy of it as it was.
create or replace function api.report_kuppi(p_session_id uuid, p_category text, p_details text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session kuppi.sessions;
  v_id uuid;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v_session := kuppi.visible_session(p_session_id);
  if v_session.host_id = v_uid then
    raise exception 'You cannot report your own kuppi.' using errcode = '22023';
  end if;
  if not exists (select 1 from safety.report_categories rc where rc.code = p_category) then
    raise exception 'Choose what is wrong.' using errcode = '22023';
  end if;
  if p_details is not null and char_length(p_details) > 1000 then
    raise exception 'Keep the details under 1,000 characters.' using errcode = '22023';
  end if;
  select r.id into v_id from safety.reports r
  where r.reporter_id = v_uid and r.target_kind = 'kuppi' and r.target_id = p_session_id::text and r.status = 'open';
  if v_id is not null then
    return v_id;
  end if;
  perform messaging.hit_limit('report', 20, 'You have sent a lot of reports today. Our team will look at them first.');
  insert into safety.reports (reporter_id, institution_id, target_kind, target_id, category_code, details, snapshot)
  values (v_uid, v_session.institution_id, 'kuppi', p_session_id::text, p_category,
          nullif(btrim(coalesce(p_details, '')), ''),
          kuppi.session_json(v_session, v_uid)
            || jsonb_build_object('meeting_url', (select l.meeting_url from kuppi.session_links l where l.session_id = p_session_id)))
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function api.report_kuppi(uuid, text, text) to authenticated;
