-- Poll voters: who voted for each option, for members only.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(7);

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9811, 'Test Omicron University', 'TOU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('omicron.test', 9811);

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

select pg_temp.make_user('00000000-0000-0000-0000-0000000ff001', '2024pv001@omicron.test', 'Amaya Fernando');
select pg_temp.make_user('00000000-0000-0000-0000-0000000ff002', '2024pv002@omicron.test', 'Bimsara Perera');
select pg_temp.make_user('00000000-0000-0000-0000-0000000ff003', '2024pv003@omicron.test', 'Chamod Silva');

select pg_temp.act_as('00000000-0000-0000-0000-0000000ff001');
select api.join_batch(null, 'BSc in Poll Studies', 2024);
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff002');
select api.join_batch((select id from academics.programmes where institution_id = 9811), null, 2024);
select set_config('role', 'postgres', true);

create temp table ids (chat uuid, poll uuid, note uuid);
insert into ids (chat) select c.id from messaging.conversations c join academics.cohorts co on co.id = c.cohort_id
  join academics.programmes p on p.id = co.programme_id where p.institution_id = 9811;
grant all on pg_temp.ids to public;

select pg_temp.act_as('00000000-0000-0000-0000-0000000ff001');
update ids set poll = (api.send_message((select chat from ids), ops.uuid_v7(), '', null, 'poll',
  '{"question": "Kuppi time?", "options": ["Morning", "Evening"], "multiple": true}') ->> 'id')::uuid;
update ids set note = (api.send_message((select chat from ids), ops.uuid_v7(), 'Just text') ->> 'id')::uuid;
select api.vote_poll((select chat from ids), (select poll from ids), '{0,1}');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff002');
select api.vote_poll((select chat from ids), (select poll from ids), '{1}');

select is((select count(*)::int from api.poll_voters((select chat from ids), (select poll from ids))), 3,
  'one row per vote (a multiple-choice voter counts under each option)');
select is((select array_agg(full_name order by full_name) from api.poll_voters((select chat from ids), (select poll from ids)) where option = 1),
  array['Amaya Fernando', 'Bimsara Perera'], 'each option lists who chose it');
select is((select array_agg(full_name) from api.poll_voters((select chat from ids), (select poll from ids)) where option = 0),
  array['Amaya Fernando'], 'and only them');

select api.vote_poll((select chat from ids), (select poll from ids), '{}');
select is((select count(*)::int from api.poll_voters((select chat from ids), (select poll from ids))), 2,
  'a vote taken back disappears from the list');

select throws_ok($$ select * from api.poll_voters((select chat from ids), (select note from ids)) $$,
  'P0002', null, 'only polls have voters');

select pg_temp.act_as('00000000-0000-0000-0000-0000000ff003');
select throws_ok($$ select * from api.poll_voters((select chat from ids), (select poll from ids)) $$,
  '42501', null, 'people outside the chat cannot see votes');

select set_config('role', 'anon', true);
select throws_ok($$ select * from api.poll_voters(gen_random_uuid(), gen_random_uuid()) $$,
  '42501', null, 'signed-out callers cannot call it');

select * from finish();
rollback;
