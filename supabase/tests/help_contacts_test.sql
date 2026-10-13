-- Help contacts: every signed-in student reads them (suspended too), contacts are checked, only
-- national admins (the Uni Era team) change any list, changes are audited.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(12);

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9800, 'Test Omega University', 'TOU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('omega.test', 9800);

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

select pg_temp.make_user('00000000-0000-0000-0000-0000000e0001', '2024oo001@omega.test', 'Sachini S');
select pg_temp.make_user('00000000-0000-0000-0000-0000000e0002', '2020oo002@omega.test', 'Moderator M');
select pg_temp.make_user('00000000-0000-0000-0000-0000000e0003', '2019oo003@omega.test', 'Admin A');
insert into identity.staff_roles (user_id, role, institution_id) values
  ('00000000-0000-0000-0000-0000000e0002', 'moderator', 9800),
  ('00000000-0000-0000-0000-0000000e0003', 'admin', null);

select pg_temp.act_as('00000000-0000-0000-0000-0000000e0001');
select ok(api.help_contacts() -> 'national' @> '[{"url": "https://eugc.ugc.ac.lk/complaint-portal/"}]',
  'students see the national contacts, with the UGC complaint portal');
select is(api.help_contacts() -> 'university_contacts', '[]'::jsonb, 'a university shows nothing until the Uni Era team adds it');
select is(api.help_contacts() ->> 'can_edit', 'false', 'students cannot edit');
select throws_ok($$ select api.set_help_contacts(9800, '[]') $$, '42501', null, 'students cannot change contacts');

select pg_temp.act_as('00000000-0000-0000-0000-0000000e0002');
select throws_ok($$ select api.set_help_contacts(9800, '[{"kind": "ragging", "label": "Committee", "phone": "0112345678"}]') $$,
  '42501', null, 'moderators cannot change their university''s contacts');
select throws_ok($$ select api.admin_help_contacts() $$, '42501', null, 'moderators cannot open the editor');

select pg_temp.act_as('00000000-0000-0000-0000-0000000e0003');
select throws_ok($$ select api.set_help_contacts(9800, '[{"kind": "ragging", "label": "Committee"}]') $$, '22023', null,
  'a contact needs a way to reach it');
select throws_ok($$ select api.set_help_contacts(9800, '[{"kind": "ragging", "label": "Committee", "url": "http://x.lk"}]') $$, '22023', null,
  'links are https');
select is(api.set_help_contacts(9800, '[{"kind": "ragging", "label": " Anti-ragging committee ", "phone": "081 239 2000"}]') -> 0 ->> 'phone',
  '0812392000', 'national admins set a university''s contacts, tidied');
select ok((select u -> 'contacts' -> 0 ->> 'label' = 'Anti-ragging committee'
           from jsonb_array_elements(api.admin_help_contacts() -> 'universities') u where (u ->> 'id')::bigint = 9800),
  'the editor lists every university with its contacts');

set local role postgres;
update identity.profiles set account_status = 'suspended' where user_id = '00000000-0000-0000-0000-0000000e0001';
select pg_temp.act_as('00000000-0000-0000-0000-0000000e0001');
select is(api.help_contacts() -> 'university_contacts' -> 0 ->> 'label', 'Anti-ragging committee', 'a suspended student still sees them');

set local role postgres;
select is((select count(*)::integer from ops.audit_log where action = 'help.contacts_changed' and target_id = '9800'), 1, 'changes are audited');

select * from finish();
rollback;
