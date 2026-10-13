-- Part-time jobs in the feed: details checked and tidied, remote work without a place, the Jobs
-- filter, marking a job filled, and closed or filled jobs sinking below open ones.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(11);

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9798, 'Test Chi University', 'TCU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('chi.test', 9798);

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
create function pg_temp.post(p_id bigint) returns feed.posts language sql security definer as $$
  select * from feed.posts where id = p_id;
$$;

select pg_temp.make_user('00000000-0000-0000-0000-0000000b0001', '2024cc001@chi.test', 'Janith J');
select pg_temp.make_user('00000000-0000-0000-0000-0000000b0002', '2024cc002@chi.test', 'Kumari K');
create temp table ids (tutor bigint, remote bigint, closed bigint);
insert into ids default values;
grant all on pg_temp.ids to public;

select pg_temp.act_as('00000000-0000-0000-0000-0000000b0001');
select throws_ok($$ select api.create_post('{"tag": "job", "details": {"area": "Kandy"}}') $$, '22023', null,
  'a job says what the work is');
select throws_ok($$ select api.create_post('{"tag": "job", "details": {"role": "Tutor", "area": "Kandy", "pay": 1500}}') $$, '22023', null,
  'pay says what it is for');
select throws_ok($$ select api.create_post('{"tag": "job", "details": {"role": "Tutor"}}') $$, '22023', null,
  'a job is somewhere, or remote');
update ids set tutor = (api.create_post('{"tag": "job", "details": {"role": " Maths tutor for O/L ", "pay": 1500, "per": "hour",
  "area": "Peradeniya", "hours": "Weekends", "phone": "071 234 5678", "closes_on": "2099-01-31"}}') ->> 'id')::bigint;
update ids set remote = (api.create_post('{"tag": "job", "details": {"role": "Data entry", "remote": true}}') ->> 'id')::bigint;
update ids set closed = (api.create_post('{"tag": "job", "details": {"role": "Event crew", "area": "Kandy", "closes_on": "2020-01-01"}}') ->> 'id')::bigint;
select is((pg_temp.post((select tutor from ids))).details ->> 'role', 'Maths tutor for O/L', 'the details are tidied');
select is((pg_temp.post((select tutor from ids))).details ->> 'phone', '0712345678', 'and the phone number cleaned');
select is((pg_temp.post((select remote from ids))).details ->> 'remote', 'true', 'remote work needs no place');
select ok(api.set_post_resolved((select remote from ids), true) ->> 'resolved' = 'true', 'the author marks a job filled');

select pg_temp.act_as('00000000-0000-0000-0000-0000000b0002');
create temp table ranked as
  select x::bigint as id, n from jsonb_array_elements(api.feed(null, 'job') -> 'ids') with ordinality as t(x, n);
grant all on pg_temp.ranked to public;
select is((select count(*)::integer from ranked where id in (select tutor from ids union all select remote from ids union all select closed from ids)), 3,
  'the Jobs filter shows jobs');
select ok((select n from ranked where id = (select tutor from ids)) < (select n from ranked where id = (select closed from ids)),
  'a job past its closing day sinks below an open one');
select ok((select n from ranked where id = (select tutor from ids)) < (select n from ranked where id = (select remote from ids)),
  'and so does a filled one');
select throws_ok($$ select api.set_post_resolved((select tutor from ids), true) $$, '42501', null, 'only the author marks it filled');

select * from finish();
rollback;
