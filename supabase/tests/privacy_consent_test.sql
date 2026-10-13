-- Privacy and consent: per-field visibility on cards and in search, the consent centre (optional
-- consents switch, required ones cannot, a new policy version asks again), and the opt-in batch
-- directory.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(15);

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9801, 'Test Alpha2 University', 'TA2', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('alpha2.test', 9801);

create function pg_temp.make_user(p_id uuid, p_email text, p_name text) returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role)
  values (p_id, p_email, jsonb_build_object('full_name', p_name), now(), 'authenticated', 'authenticated');
  update identity.profiles set account_status = 'active', name_confirmed_at = now(), avatar_path = 'avatars/' || p_id || '/00000000-0000-0000-0000-00000000aaaa.jpg'
  where user_id = p_id;
$$;
create function pg_temp.act_as(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;

-- a and b: one batch. c: same university, another batch.
select pg_temp.make_user('00000000-0000-0000-0000-0000000a2001', '2024aa001@alpha2.test', 'Amali Perera');
select pg_temp.make_user('00000000-0000-0000-0000-0000000a2002', '2024aa002@alpha2.test', 'Buddhika Silva');
select pg_temp.make_user('00000000-0000-0000-0000-0000000a2003', '2022aa003@alpha2.test', 'Chamath Fernando');
select pg_temp.act_as('00000000-0000-0000-0000-0000000a2001');
select api.join_batch(null, 'BSc in Privacy', 2024);
select pg_temp.act_as('00000000-0000-0000-0000-0000000a2002');
select api.join_batch(null, 'BSc in Privacy', 2024);
select pg_temp.act_as('00000000-0000-0000-0000-0000000a2003');
select api.join_batch(null, 'BSc in Privacy', 2022);

-- ---------------------------------------------------------------- per-field visibility
select pg_temp.act_as('00000000-0000-0000-0000-0000000a2001');
select throws_ok($$ select api.set_field_visibility('photo', 'aliens') $$, '22023', null, 'only the four choices');
select api.set_field_visibility('photo', 'my_cohort');
select api.set_field_visibility('batch', 'nobody');
select pg_temp.act_as('00000000-0000-0000-0000-0000000a2003');
select is(api.person('00000000-0000-0000-0000-0000000a2001') ->> 'avatar_path', null, 'a photo for the batch is hidden from others');
select is(api.person('00000000-0000-0000-0000-0000000a2001') -> 'batch', 'null'::jsonb, 'and a batch shown to no one');
select is((select avatar_path from api.search_people('amali')), null, 'search follows the same choices');
select pg_temp.act_as('00000000-0000-0000-0000-0000000a2002');
select is(api.person('00000000-0000-0000-0000-0000000a2001') ->> 'avatar_path', 'avatars/00000000-0000-0000-0000-0000000a2001/00000000-0000-0000-0000-00000000aaaa.jpg', 'batchmates see the photo');

-- ---------------------------------------------------------------- consent centre
select pg_temp.act_as('00000000-0000-0000-0000-0000000a2001');
select is(api.my_consents() ->> 'needs_reconsent', 'false', 'sign-up consents are up to date');
select throws_ok($$ select api.set_consent('community_guidelines', false) $$, '22023', null, 'required consents cannot be switched off');
select is((select x ->> 'granted' from jsonb_array_elements(api.set_consent('analytics', true) -> 'purposes') x where x ->> 'code' = 'analytics'),
  'true', 'optional ones can');
set local role postgres;
update identity.consent_purposes set current_version = 'v2' where code = 'community_guidelines';
select pg_temp.act_as('00000000-0000-0000-0000-0000000a2001');
select is(api.my_consents() ->> 'needs_reconsent', 'true', 'a new guidelines version asks again');
select is(api.accept_policies() ->> 'needs_reconsent', 'false', 'until accepted');

-- ---------------------------------------------------------------- batch directory
select pg_temp.act_as('00000000-0000-0000-0000-0000000a2002');
select is(api.batch_directory() ->> 'asked', 'false', 'students are asked once');
select is(jsonb_array_length(api.batch_directory() -> 'people'), 0, 'nobody is listed until they say yes');
select pg_temp.act_as('00000000-0000-0000-0000-0000000a2001');
select api.set_consent('batch_directory', true, 'prompt');
select api.update_privacy('nobody', null);
select pg_temp.act_as('00000000-0000-0000-0000-0000000a2002');
select is(api.batch_directory() -> 'people' -> 0 ->> 'full_name', 'Amali Perera', 'a yes lists them for their batch');
select is(api.person('00000000-0000-0000-0000-0000000a2001') ->> 'full_name', 'Amali Perera',
  'and batchmates can open their card even when search cannot find them');
select pg_temp.act_as('00000000-0000-0000-0000-0000000a2003');
select is((select count(*)::integer from jsonb_array_elements(api.batch_directory() -> 'people') x
           where x ->> 'full_name' = 'Amali Perera'), 0, 'other batches do not see them');

select * from finish();
rollback;
