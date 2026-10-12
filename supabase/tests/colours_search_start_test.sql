-- Module colours (each student's own), search across kuppi and requests, and the first-week checklist.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(14);

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9896, 'Test Sigma Three University', 'TS3', 'state', 'live'),
  (9897, 'Test Omega Two University', 'TO2', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('s3.test', 9896), ('o2.test', 9897);

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
create function pg_temp.mod(p_inst bigint) returns bigint language sql as $$
  select id from academics.modules where institution_id = p_inst order by id limit 1;
$$;

-- a, b: Sigma Three 2025 batch. o: Omega Two.
select pg_temp.make_user('00000000-0000-0000-0000-0000000b0101', '2025ss001@s3.test', 'Asha A');
select pg_temp.make_user('00000000-0000-0000-0000-0000000b0102', '2025ss002@s3.test', 'Bimal B');
select pg_temp.make_user('00000000-0000-0000-0000-0000000b0201', '2025oo001@o2.test', 'Oshan O');
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0101');
select api.join_batch(null, 'BSc in Sigma Computing', 2025);
select api.set_batch_term(1, 1);
select api.save_semester(1, 1, '[{"code": "CS1012", "name": "Programming Fundamentals"}]');
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0102');
select api.join_batch((select id from academics.programmes where institution_id = 9896), null, 2025);
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0201');
select api.join_batch(null, 'BSc in Omega Computing', 2025);
select api.set_batch_term(1, 1);
select api.save_semester(1, 1, '[{"code": "IT1010", "name": "Introduction to Programming"}]');

-- ---------------------------------------------------------------- colours
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0101');
select is(api.module_colours(), '{}'::jsonb, 'no colours chosen at first');
select is((api.set_module_colour(pg_temp.mod(9896), 'rose') ->> pg_temp.mod(9896)::text), 'rose', 'a student picks a colour');
select is((api.set_module_colour(pg_temp.mod(9896), 'teal') ->> pg_temp.mod(9896)::text), 'teal', 'and changes it');
select throws_ok($$ select api.set_module_colour(pg_temp.mod(9896), 'neon') $$, '22023', null, 'only the palette''s colours');
select throws_ok($$ select api.set_module_colour(pg_temp.mod(9897), 'rose') $$, '22023', null, 'only for modules at their university');
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0102');
select is(api.module_colours(), '{}'::jsonb, 'colours are each student''s own');
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0101');
select is(api.set_module_colour(pg_temp.mod(9896), null), '{}'::jsonb, 'null goes back to the app''s choice');

-- ---------------------------------------------------------------- search
select api.create_kuppi(pg_temp.mod(9896), 'Recursion made easy', now() + interval '2 days', 60, 'online', 30,
                        'https://meet.google.com/abc-defg-hij');
select api.request_kuppi(pg_temp.mod(9896), 'Pointers and memory', null, 'university');
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0102');
select is((api.kuppi_search('recursion') -> 'sessions' -> 0 ->> 'title'), 'Recursion made easy', 'kuppi are found by topic');
select is(jsonb_array_length(api.kuppi_search('Programming Fundamentals') -> 'sessions'), 1, 'and by module name');
select is((api.kuppi_search('pointers') -> 'requests' -> 0 ->> 'topic'), 'Pointers and memory', 'requests are found too');
select is(jsonb_array_length(api.kuppi_search('r') -> 'sessions'), 0, 'one letter finds nothing');
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0201');
select is(jsonb_array_length(api.kuppi_search('recursion') -> 'sessions'), 0, 'another university does not see them');

-- ---------------------------------------------------------------- first-week checklist
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0102');
select ok((api.resources_start() ->> 'batch_chat_id') is not null, 'the checklist knows the batch chat');
select is((api.resources_start() ->> 'batch_chat_opened'), 'false', 'and whether the student has opened it');

select * from finish();
rollback;
