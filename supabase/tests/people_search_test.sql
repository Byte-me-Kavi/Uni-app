-- People search: matching, ranking, typo correction, privacy, blocks, keys kept in sync.
-- Run with: supabase test db

begin;
-- On a linked project the runner logs in as a temporary CLI role; run as postgres, as locally.
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(30);

-- ---------------------------------------------------------------- fixtures
insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9201, 'Test Epsilon University', 'TEU', 'state', 'live'),
  (9202, 'Test Zeta University', 'TZU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('epsilon.test', 9201), ('zeta.test', 9202);

create function pg_temp.make_user(p_id uuid, p_email text, p_name text, p_active boolean default true) returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role)
  values (p_id, p_email, jsonb_build_object('full_name', p_name), now(), 'authenticated', 'authenticated');
  update identity.profiles set account_status = 'active', name_confirmed_at = now()
  where user_id = p_id and p_active;
$$;
create function pg_temp.act_as(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
-- Results from the test universities only, so real accounts in a linked database do not interfere.
create function pg_temp.results(p_query text) returns setof record language sql as $$
  select full_name, relation, programme, intake_year, corrected from api.search_people(p_query)
  where institution in ('TEU', 'TZU');
$$;
create function pg_temp.names(p_query text) returns text[] language sql as $$
  select coalesce(array_agg(full_name), '{}') from pg_temp.results(p_query)
    as r (full_name text, relation text, programme text, intake_year int, corrected boolean);
$$;

select pg_temp.make_user('00000000-0000-0000-0000-00000000e001', '2024cs001@epsilon.test', 'Nimal Perera');
select pg_temp.make_user('00000000-0000-0000-0000-00000000e002', '2024cs002@epsilon.test', 'Kavisha Dilshan Munasinghe');
select pg_temp.make_user('00000000-0000-0000-0000-00000000e003', '2023ps001@epsilon.test', 'Kavindu Munasinghe');
select pg_temp.make_user('00000000-0000-0000-0000-00000000e004', '2024cs004@epsilon.test', 'Kavya Pending', false);
select pg_temp.make_user('00000000-0000-0000-0000-00000000e005', '2024cs005@epsilon.test', 'Kavithma Blocked');
select pg_temp.make_user('00000000-0000-0000-0000-00000000e006', '2024cs006@epsilon.test', 'Kavin Blocker');
select pg_temp.make_user('00000000-0000-0000-0000-00000000e007', '2024cs007@epsilon.test', 'කවිෂ මුණසිංහ');
select pg_temp.make_user('00000000-0000-0000-0000-00000000f001', '2024cs001@zeta.test', 'Kavinda Jayasuriya');
select pg_temp.make_user('00000000-0000-0000-0000-00000000f002', '2024cs002@zeta.test', 'Kavishka Silva');
select pg_temp.make_user('00000000-0000-0000-0000-00000000f003', '2024cs003@zeta.test', 'Kaveesha Hidden');

update identity.privacy_settings set findable_by = 'my_institution' where user_id = '00000000-0000-0000-0000-00000000f002';
update identity.privacy_settings set findable_by = 'nobody' where user_id = '00000000-0000-0000-0000-00000000f003';
insert into safety.blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000e005'),
  ('00000000-0000-0000-0000-00000000e006', '00000000-0000-0000-0000-00000000e001');

-- Nimal and Kavisha are batchmates.
select pg_temp.act_as('00000000-0000-0000-0000-00000000e001');
select api.join_batch(null, 'BSc in Computer Science', 2024);
select pg_temp.act_as('00000000-0000-0000-0000-00000000e002');
select api.join_batch((select id from academics.programmes where institution_id = 9201 limit 1), null, 2024);

-- ---------------------------------------------------------------- matching and ranking
select pg_temp.act_as('00000000-0000-0000-0000-00000000e001');
select is(pg_temp.names('kav'),
  array['Kavisha Dilshan Munasinghe', 'Kavindu Munasinghe', 'Kavinda Jayasuriya'],
  'a prefix finds batchmates first, then the same university, then other universities');
select is((select array_agg(coalesce(relation, '-')) from api.search_people('kav') where institution in ('TEU', 'TZU')),
  array['batchmate', 'university', '-'], 'each result says how it relates to the searcher');
select is((select programme || ' ' || intake_year from api.search_people('kavisha') where institution = 'TEU'),
  'BSc in Computer Science 2024', 'results show the batch');
select is(pg_temp.names('munasinghe'), array['Kavisha Dilshan Munasinghe', 'Kavindu Munasinghe'], 'a surname matches');
select is(pg_temp.names('kavisha mun'), array['Kavisha Dilshan Munasinghe'], 'first name and surname, skipping the middle name');
select is(pg_temp.names('kav mun'), array['Kavisha Dilshan Munasinghe', 'Kavindu Munasinghe'], 'both words shortened');
select is(pg_temp.names('Munasinghe, KAVI'), array['Kavisha Dilshan Munasinghe', 'Kavindu Munasinghe'], 'surname first, any case and punctuation');
select is(pg_temp.names('කවි'), array['කවිෂ මුණසිංහ'], 'Sinhala names are searchable');
select is(pg_temp.names('k'), '{}'::text[], 'one letter searches nothing');

-- ---------------------------------------------------------------- typos
select is(pg_temp.names('kvaisha'), array['Kavisha Dilshan Munasinghe'], 'a typo is corrected when nothing matches');
select is((select bool_and(corrected) from api.search_people('kvaisha')), true, 'corrected results are marked');
select is((select bool_or(corrected) from api.search_people('kavisha')), false, 'exact results are not marked');

-- ---------------------------------------------------------------- who can be found
select is((select count(*)::int from api.search_people('kavishka silva') where full_name = 'Kavishka Silva'), 0,
  'my_institution: hidden from other universities');
select is((select count(*)::int from api.search_people('kaveesha hidden') where full_name = 'Kaveesha Hidden'), 0,
  'nobody: hidden from everyone');
select is((select count(*)::int from api.search_people('kavya') where full_name = 'Kavya Pending'), 0, 'pending accounts are not listed');
select is((select count(*)::int from api.search_people('kavithma') where full_name = 'Kavithma Blocked'), 0, 'someone I blocked is not listed');
select is((select count(*)::int from api.search_people('kavin blocker') where full_name = 'Kavin Blocker'), 0, 'someone who blocked me is not listed');
select is((select count(*)::int from api.search_people('nimal') where full_name = 'Nimal Perera'), 0, 'I am not listed in my own search');

select pg_temp.act_as('00000000-0000-0000-0000-00000000f001');
select is(pg_temp.names('kavishka'), array['Kavishka Silva'], 'my_institution: found by the same university');

select pg_temp.act_as('00000000-0000-0000-0000-00000000e004');
select throws_ok($$ select * from api.search_people('kav') $$, '42501', null, 'pending accounts cannot search');

-- ---------------------------------------------------------------- the public card
select pg_temp.act_as('00000000-0000-0000-0000-00000000e001');
select is(api.person('00000000-0000-0000-0000-00000000e002') ->> 'relation', 'batchmate', 'a batchmate card');
select is(api.person('00000000-0000-0000-0000-00000000f002'), null, 'no card for someone hidden from me');
select is(api.person('00000000-0000-0000-0000-00000000e005'), null, 'no card for someone I blocked');

-- ---------------------------------------------------------------- the student's own setting
select pg_temp.act_as('00000000-0000-0000-0000-00000000e002');
select is(api.my_account() ->> 'findable_by', 'everyone', 'findable by every university unless changed');
select is(api.set_findable_by('nobody'), 'nobody', 'a student can hide from search');
select pg_temp.act_as('00000000-0000-0000-0000-00000000e001');
select is(pg_temp.names('kavisha'), '{}'::text[], 'hidden at once, even from a batchmate');
select pg_temp.act_as('00000000-0000-0000-0000-00000000e002');
select throws_ok($$ select api.set_findable_by('friends') $$, '22023', null, 'only the three settings are accepted');
select api.set_findable_by('everyone');

-- ---------------------------------------------------------------- keys follow changes
select set_config('role', 'postgres', true);
update identity.profiles set full_name = 'Kavindu Rathnayake' where user_id = '00000000-0000-0000-0000-00000000e003';
select pg_temp.act_as('00000000-0000-0000-0000-00000000e001');
select is(pg_temp.names('munasinghe'), array['Kavisha Dilshan Munasinghe'], 'a renamed student is found by the new name only');

select set_config('role', 'postgres', true);
delete from auth.users where id = '00000000-0000-0000-0000-00000000e003';
select is((select count(*)::int from identity.search_words where word in ('kavindu', 'rathnayake')), 0,
  'deleting an account removes its words from the typo dictionary');

-- ---------------------------------------------------------------- rate limit
insert into ops.rate_limits (user_id, action, window_start, hits)
values ('00000000-0000-0000-0000-00000000e001', 'search_people', date_trunc('minute', now()), 120)
on conflict on constraint rate_limits_pkey do update set hits = 120;
select pg_temp.act_as('00000000-0000-0000-0000-00000000e001');
select throws_ok($$ select * from api.search_people('kav') $$, 'PT429', null, 'more than 120 searches a minute is refused');

select * from finish();
rollback;
