-- Kuppi: hosting (checked links and times), listing, RSVP with capacity, the link shown only to
-- RSVP'd students from 15 minutes before, the kuppi chat following RSVPs, cancelling, reporting,
-- blocks, and other universities kept out.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(35);

select is(kuppi.meeting_platform('https://us02web.zoom.us/j/123?pwd=x'), 'zoom', 'Zoom links are recognised');
select is(kuppi.meeting_platform('https://meet.google.com/abc-defg-hij'), 'meet', 'Meet links are recognised');
select is(kuppi.meeting_platform('https://teams.microsoft.com/l/meetup-join/x'), 'teams', 'Teams links are recognised');
select is(kuppi.meeting_platform('https://zoom.us.evil.com/j/1'), null, 'look-alike links are refused');

-- ---------------------------------------------------------------- fixtures
insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9851, 'Test Omega University', 'TOU', 'state', 'live'),
  (9852, 'Test Zeta University', 'TZU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('omega.test', 9851), ('zeta.test', 9852);

create function pg_temp.make_user(p_id uuid, p_email text, p_name text) returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role)
  values (p_id, p_email, jsonb_build_object('full_name', p_name), now(), 'authenticated', 'authenticated');
  update identity.profiles set account_status = 'active', name_confirmed_at = now() where user_id = p_id;
$$;
create function pg_temp.act_as(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.mod() returns bigint language sql as $$
  select id from academics.modules where institution_id = 9851 and code_key = 'CS2012';
$$;

-- h: host. a, b, c: students. o: Omega student in another batch. z: Zeta student.
select pg_temp.make_user('00000000-0000-0000-0000-00000000f101', '2025kk001@omega.test', 'Hasini Host');
select pg_temp.make_user('00000000-0000-0000-0000-00000000f102', '2025kk002@omega.test', 'Amal A');
select pg_temp.make_user('00000000-0000-0000-0000-00000000f103', '2025kk003@omega.test', 'Bimal B');
select pg_temp.make_user('00000000-0000-0000-0000-00000000f104', '2025kk004@omega.test', 'Chamal C');
select pg_temp.make_user('00000000-0000-0000-0000-00000000f105', '2024oo001@omega.test', 'Other O');
select pg_temp.make_user('00000000-0000-0000-0000-00000000f201', '2025kk001@zeta.test', 'Zara Z');
select pg_temp.act_as('00000000-0000-0000-0000-00000000f101');
select api.join_batch(null, 'BSc in Kuppi Studies', 2025);
select api.set_batch_term(1, 1);
select api.save_semester(1, 1, '[{"code": "CS2012", "name": "Data Structures"}]');
select pg_temp.act_as('00000000-0000-0000-0000-00000000f102');
select api.join_batch((select id from academics.programmes where institution_id = 9851), null, 2025);
select pg_temp.act_as('00000000-0000-0000-0000-00000000f103');
select api.join_batch((select id from academics.programmes where institution_id = 9851), null, 2025);
select pg_temp.act_as('00000000-0000-0000-0000-00000000f104');
select api.join_batch((select id from academics.programmes where institution_id = 9851), null, 2025);
select pg_temp.act_as('00000000-0000-0000-0000-00000000f105');
select api.join_batch(null, 'BSc in Other Studies', 2024);
select pg_temp.act_as('00000000-0000-0000-0000-00000000f201');
select api.join_batch(null, 'BSc in Kuppi Studies', 2025);
select set_config('role', 'postgres', true);

create temp table ids (soon uuid, later uuid, venue uuid);
insert into ids default values;
grant all on pg_temp.ids to public;

-- ---------------------------------------------------------------- hosting
select pg_temp.act_as('00000000-0000-0000-0000-00000000f101');
select throws_ok($$ select api.create_kuppi(pg_temp.mod(), 'AVL trees', now() + interval '1 day', 60, 'online', 10,
  'https://example.com/meeting') $$, '22023', null, 'only Zoom, Meet or Teams links');
select throws_ok($$ select api.create_kuppi(pg_temp.mod(), 'AVL trees', now() - interval '1 hour', 60, 'online', 10,
  'https://zoom.us/j/1') $$, '22023', null, 'not in the past');
select throws_ok($$ select api.create_kuppi(pg_temp.mod(), 'AVL trees', now() + interval '1 day', 60, 'in_person', 10) $$,
  '22023', null, 'in person needs a venue');
-- Starts in 10 minutes (the link is already open), capacity 2.
update ids set soon = (api.create_kuppi(pg_temp.mod(), 'AVL trees', now() + interval '10 minutes', 60, 'online', 2,
  'https://zoom.us/j/111') ->> 'id')::uuid;
update ids set later = (api.create_kuppi(pg_temp.mod(), 'Heaps', now() + interval '2 days', 90, 'online', 30,
  'https://meet.google.com/abc-defg-hij') ->> 'id')::uuid;
update ids set venue = (api.create_kuppi(pg_temp.mod(), 'Past paper walk-through', now() + interval '3 days', 120, 'in_person', 50,
  null, 'Hall A') ->> 'id')::uuid;
select is((api.kuppi((select soon from ids)) ->> 'hosting'), 'true', 'the host sees they are hosting');
select ok((api.kuppi((select soon from ids)) ->> 'chat_id') is not null, 'and is in the kuppi chat');
select is((api.reveal_link((select later from ids)) ->> 'url'), 'https://meet.google.com/abc-defg-hij', 'the host can always see the link');

-- ---------------------------------------------------------------- listing
select pg_temp.act_as('00000000-0000-0000-0000-00000000f102');
select is(jsonb_array_length(api.kuppi_list('my_modules')), 3, 'kuppi for my modules');
select is((api.kuppi_list('module', pg_temp.mod()) -> 0 ->> 'title'), 'AVL trees', 'soonest first');
select is((api.kuppi_list('all') -> 0 ->> 'link_opens_at')::timestamptz, now() - interval '5 minutes',
  'the list says when the link opens');
select pg_temp.act_as('00000000-0000-0000-0000-00000000f105');
select is(jsonb_array_length(api.kuppi_list('all')), 3, 'everyone at the university sees kuppi');
select is(jsonb_array_length(api.kuppi_list('my_modules')), 0, 'but only students taking the module see them as theirs');
select pg_temp.act_as('00000000-0000-0000-0000-00000000f201');
select is(jsonb_array_length(api.kuppi_list('all')), 0, 'another university sees none');
select throws_ok($$ select api.rsvp((select soon from ids)) $$, 'P0002', null, 'and cannot RSVP');

-- ---------------------------------------------------------------- RSVP, capacity, the link
select pg_temp.act_as('00000000-0000-0000-0000-00000000f102');
select throws_ok($$ select api.reveal_link((select soon from ids)) $$, '42501', null, 'no link without an RSVP');
select is((api.rsvp((select soon from ids)) ->> 'going'), '1', 'RSVP counts');
select ok((api.kuppi((select soon from ids)) ->> 'chat_id') is not null, 'RSVP joins the kuppi chat');
select is((api.reveal_link((select soon from ids)) ->> 'url'), 'https://zoom.us/j/111', 'the link opens 15 minutes before');
select api.rsvp((select later from ids));
select throws_ok($$ select api.reveal_link((select later from ids)) $$, '22023', null, 'but not earlier');
select pg_temp.act_as('00000000-0000-0000-0000-00000000f103');
select is((api.rsvp((select soon from ids)) ->> 'full'), 'true', 'the last seat fills it');
select pg_temp.act_as('00000000-0000-0000-0000-00000000f104');
select throws_ok($$ select api.rsvp((select soon from ids)) $$, '22023', null, 'a full kuppi refuses more RSVPs');
select pg_temp.act_as('00000000-0000-0000-0000-00000000f103');
select is((api.cancel_rsvp((select soon from ids)) ->> 'going'), '1', 'cancelling frees the seat');
select is((api.kuppi((select soon from ids)) ->> 'chat_id'), null, 'and leaves the kuppi chat');
select pg_temp.act_as('00000000-0000-0000-0000-00000000f104');
select lives_ok($$ select api.rsvp((select soon from ids)) $$, 'so someone else can take it');
select pg_temp.act_as('00000000-0000-0000-0000-00000000f101');
select throws_ok($$ select api.rsvp((select soon from ids)) $$, '22023', null, 'hosts do not RSVP to their own kuppi');

-- ---------------------------------------------------------------- blocks, cancelling, reporting
select pg_temp.act_as('00000000-0000-0000-0000-00000000f103');
select api.block_user('00000000-0000-0000-0000-00000000f101');
select is(jsonb_array_length(api.kuppi_list('all')), 0, 'kuppi by a student you blocked are hidden');
select pg_temp.act_as('00000000-0000-0000-0000-00000000f102');
select throws_ok($$ select api.cancel_kuppi((select later from ids)) $$, '42501', null, 'only the host cancels');
select lives_ok($$ select api.report_kuppi((select later from ids), 'scam', 'asks for money') $$, 'a kuppi can be reported');
select pg_temp.act_as('00000000-0000-0000-0000-00000000f101');
select is((api.cancel_kuppi((select later from ids), 'Clashes with the exam') ->> 'cancelled'), 'true', 'the host cancels');
select pg_temp.act_as('00000000-0000-0000-0000-00000000f102');
select is((api.kuppi_list('mine') -> 1 ->> 'cancelled'), 'true', 'students going see it was cancelled');
select throws_ok($$ select count(*) from kuppi.session_links $$, '42501', null, 'links are never readable directly');
select throws_ok($$ select count(*) from kuppi.sessions $$, '42501', null, 'nor are sessions');

select * from finish();
rollback;
