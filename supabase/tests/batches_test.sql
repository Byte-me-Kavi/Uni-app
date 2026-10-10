-- Batches: suggestion from the email, typed programmes, learning, the batch chat, isolation.
-- Run with: supabase test db

begin;
-- On a linked project the runner logs in as a temporary CLI role; run as postgres, as locally.
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(16);

-- ---------------------------------------------------------------- email parsing
select is((select email_code from identity.parse_student_email('2023cs115@stu.ucsc.cmb.ac.lk')), 'cs', '2023cs115 gives code cs');
select is((select intake_year from identity.parse_student_email('2023cs115@stu.ucsc.cmb.ac.lk')), 2023, '2023cs115 gives intake 2023');
select is((select intake_year from identity.parse_student_email('bandara-cs22050@stu.kln.ac.lk')), 2022, 'bandara-cs22050 gives intake 2022');
select is((select intake_year from identity.parse_student_email('nimal.perera@stu.example.lk')), null, 'an email without a year suggests nothing');

-- ---------------------------------------------------------------- fixtures
insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9101, 'Test Gamma University', 'TGU', 'state', 'live'),
  (9102, 'Test Delta University', 'TDU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('gamma.test', 9101), ('delta.test', 9102);

create function pg_temp.make_user(p_id uuid, p_email text) returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role)
  values (p_id, p_email, '{"full_name":"Test Student"}', now(), 'authenticated', 'authenticated');
  update identity.profiles set account_status = 'active' where user_id = p_id;
$$;
create function pg_temp.act_as(p_id uuid, p_email text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'email', p_email)::text, true);
end $$;

select pg_temp.make_user('00000000-0000-0000-0000-0000000000a1', '2024cs001@gamma.test');
select pg_temp.make_user('00000000-0000-0000-0000-0000000000a2', '2024cs002@gamma.test');
select pg_temp.make_user('00000000-0000-0000-0000-0000000000a3', '2024cs003@gamma.test');
select pg_temp.make_user('00000000-0000-0000-0000-0000000000d1', '2024cs001@delta.test');

-- ---------------------------------------------------------------- first student types it
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', '2024cs001@gamma.test');
select is(api.batch_suggestion() -> 'programme', 'null'::jsonb, 'nothing to suggest before anyone has joined');
select is((api.batch_suggestion() ->> 'intake_year')::int, 2024, 'the intake year still comes from the email');
select is((api.join_batch(null, 'BSc in Computer Science', 2024) ->> 'members')::int, 1, 'the first student creates the batch');

-- ---------------------------------------------------------------- the next student gets a one-tap suggestion
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2', '2024cs002@gamma.test');
select is(api.batch_suggestion() -> 'programme' ->> 'name', 'BSc in Computer Science', 'the same email code now suggests that programme');
select is((select members from api.search_programmes('computer', 2024) limit 1), 1, 'search shows the batch with its member count');
select is(
  (api.join_batch((api.batch_suggestion() -> 'programme' ->> 'id')::bigint, null, 2024) ->> 'members')::int,
  2, 'confirming the suggestion joins the same batch');
select throws_ok($$ select api.join_batch(null, 'Anything', 2024) $$, '22023', null, 'a student can join only one batch');

-- ---------------------------------------------------------------- spelling differences converge
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3', '2024cs003@gamma.test');
select is((api.join_batch(null, 'B.Sc. in  Computer-Science', 2024) ->> 'members')::int, 3, 'a different spelling lands in the same batch');

-- ---------------------------------------------------------------- other universities are separate
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1', '2024cs001@delta.test');
select is((select count(*)::int from api.search_programmes('computer', 2024)), 0, 'programmes from another university are not suggested');
select is(api.batch_suggestion() -> 'programme', 'null'::jsonb, 'email codes are learned per university');
select throws_ok(
  $$ select api.join_batch((select id from academics.programmes where institution_id = 9101 limit 1), null, 2024) $$,
  '22023', null, 'a student cannot join a batch at another university');

-- ---------------------------------------------------------------- the batch chat
select set_config('role', 'postgres', true);
select is(
  (select count(*)::int from messaging.conversation_members m
   join messaging.conversations c on c.id = m.conversation_id
   join academics.cohorts co on co.id = c.cohort_id
   join academics.programmes p on p.id = co.programme_id
   where p.institution_id = 9101),
  3, 'all three batchmates are in the batch group chat');

select * from finish();
rollback;
