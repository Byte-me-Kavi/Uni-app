-- Names chosen after approval, and batch names that include the university.
-- Run with: supabase test db

begin;
-- On a linked project the runner logs in as a temporary CLI role; run as postgres, as locally.
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(18);

-- ---------------------------------------------------------------- fixtures
insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9301, 'Test Eta University', 'THU', 'state', 'live'),
  (9302, 'Test Theta University', null, 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('eta.test', 9301), ('theta.test', 9302);

create function pg_temp.make_user(p_id uuid, p_email text, p_meta jsonb, p_active boolean default true) returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role)
  values (p_id, p_email, p_meta, now(), 'authenticated', 'authenticated');
  update identity.profiles set account_status = 'active' where user_id = p_id and p_active;
$$;
create function pg_temp.act_as(p_id uuid, p_email text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'email', p_email)::text, true);
end $$;
create function pg_temp.name_claim(p_id uuid) returns jsonb language sql as $$
  select identity.custom_access_token(jsonb_build_object('user_id', p_id, 'claims', '{}'::jsonb))
    -> 'claims' -> 'app_metadata' -> 'name_confirmed';
$$;

select pg_temp.make_user('00000000-0000-0000-0000-00000000a901', '2024cs001@eta.test', '{}');
select pg_temp.make_user('00000000-0000-0000-0000-00000000a902', 'nadeesha@eta.test', '{"full_name":"Nadeesha Perera"}');
select pg_temp.make_user('00000000-0000-0000-0000-00000000a903', '2024cs003@eta.test', '{}', false);
select pg_temp.make_user('00000000-0000-0000-0000-00000000b901', '2024cs001@theta.test', '{}');

-- ---------------------------------------------------------------- before the name is chosen
select is((select full_name from identity.profiles where user_id = '00000000-0000-0000-0000-00000000a901'), '2024cs001',
  'without a name, the profile holds the email''s local part');
select is(pg_temp.name_claim('00000000-0000-0000-0000-00000000a901'), 'false'::jsonb, 'the token says the name is not chosen yet');

select pg_temp.act_as('00000000-0000-0000-0000-00000000a902', 'nadeesha@eta.test');
select is((api.my_account() ->> 'name_confirmed')::boolean, false, 'a name given at sign-up still waits for the student');

select pg_temp.act_as('00000000-0000-0000-0000-00000000b901', '2024cs001@theta.test');
select is((select count(*)::int from api.search_people('nadeesha') where full_name = 'Nadeesha Perera'), 0,
  'students who have not chosen their name are not searchable');

-- ---------------------------------------------------------------- choosing the name
select pg_temp.act_as('00000000-0000-0000-0000-00000000a901', '2024cs001@eta.test');
select throws_ok($$ select api.set_my_name('Kasun 123') $$, '22023', null, 'digits are refused');
select throws_ok($$ select api.set_my_name('kasun@uni') $$, '22023', null, 'symbols are refused');
select throws_ok($$ select api.set_my_name('K') $$, '22023', null, 'one letter is refused');
select is(api.set_my_name('  Kasun   Bandara '), 'Kasun Bandara', 'the name is saved with spacing tidied');
select throws_ok($$ select api.set_my_name('Someone Else') $$, '22023', null, 'the name is chosen once; later changes go through the Uni Era team');
select set_config('role', 'postgres', true);
select is(pg_temp.name_claim('00000000-0000-0000-0000-00000000a901'), 'true'::jsonb, 'the token then says the name is chosen');

select pg_temp.act_as('00000000-0000-0000-0000-00000000b901', '2024cs001@theta.test');
select is((select count(*)::int from api.search_people('kasun ban') where full_name = 'Kasun Bandara'), 1,
  'once chosen, the student is searchable');

select pg_temp.act_as('00000000-0000-0000-0000-00000000a902', 'nadeesha@eta.test');
select is(api.set_my_name('නදීෂා පෙරේරා'), 'නදීෂා පෙරේරා', 'Sinhala names are accepted');

select pg_temp.act_as('00000000-0000-0000-0000-00000000a903', '2024cs003@eta.test');
select throws_ok($$ select api.set_my_name('Pending Person') $$, '42501', null, 'accounts waiting for approval cannot set a name');

-- ---------------------------------------------------------------- batch names
select pg_temp.act_as('00000000-0000-0000-0000-00000000a901', '2024cs001@eta.test');
select is(api.join_batch(null, 'BSc in Computer Science', 2024) ->> 'name', 'THU · BSc in Computer Science · 2024',
  'a batch is named with its university');
select is(api.my_home() -> 'batch' ->> 'name', 'THU · BSc in Computer Science · 2024', 'home shows the batch name');

select set_config('role', 'postgres', true);
select is(
  (select c.title from messaging.conversations c join academics.cohorts co on co.id = c.cohort_id
   join academics.programmes p on p.id = co.programme_id where p.institution_id = 9301),
  'THU · BSc in Computer Science · 2024', 'the batch group chat has the batch name');

update academics.programmes set name = 'BSc in Data Science' where institution_id = 9301;
select is(
  (select c.title from messaging.conversations c join academics.cohorts co on co.id = c.cohort_id
   join academics.programmes p on p.id = co.programme_id where p.institution_id = 9301),
  'THU · BSc in Data Science · 2024', 'renaming the programme renames the chat');

select pg_temp.act_as('00000000-0000-0000-0000-00000000b901', '2024cs001@theta.test');
select is(api.join_batch(null, 'BSc in Computer Science', 2024) ->> 'name', 'Test Theta University · BSc in Computer Science · 2024',
  'a university without a short name uses its full name, so the same programme elsewhere is a different group');

select * from finish();
rollback;
