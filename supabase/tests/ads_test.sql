-- Ads on Home: only admins place them (national admins anywhere, scoped admins at their university),
-- media must be checked uploads, students see live ads for their university, views and taps are
-- counted once per student per day.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(20);

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9761, 'Test Nu University', 'TNU', 'state', 'live'),
  (9762, 'Test Xi University', 'TXU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('nu.test', 9761), ('xi.test', 9762);

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
create function pg_temp.cta(p_id uuid) returns text language sql security definer as $$ select cta_label from ads.campaigns where id = p_id; $$;
-- An upload the media function has checked.
create function pg_temp.checked_upload(p_kind text, p_mime text) returns text language plpgsql as $$
declare v text;
begin
  v := api.begin_ad_upload(p_kind, p_mime, 200000) ->> 'path';
  perform set_config('role', 'postgres', true);
  perform api.ad_upload_checked(v, true);
  perform set_config('role', 'authenticated', true);
  return v;
end $$;

-- n: national admin. s: admin at Nu. m: moderator at Nu. a: student at Nu. x: student at Xi.
select pg_temp.make_user('00000000-0000-0000-0000-0000000f6001', 'admin@nu.test', 'Nimal N');
select pg_temp.make_user('00000000-0000-0000-0000-0000000f6002', 'scoped@nu.test', 'Sanduni S');
select pg_temp.make_user('00000000-0000-0000-0000-0000000f6003', 'mod@nu.test', 'Mahesh M');
select pg_temp.make_user('00000000-0000-0000-0000-0000000f6004', '2025nn001@nu.test', 'Anjali A');
select pg_temp.make_user('00000000-0000-0000-0000-0000000f6005', '2025xx001@xi.test', 'Xavier X');
insert into identity.staff_roles (user_id, role, institution_id) values
  ('00000000-0000-0000-0000-0000000f6001', 'admin', null),
  ('00000000-0000-0000-0000-0000000f6002', 'admin', 9761),
  ('00000000-0000-0000-0000-0000000f6003', 'moderator', 9761);
-- Real ads on the database would change the counts; paused here (rolled back).
update ads.campaigns set active = false;
create temp table ids (everywhere uuid, nu uuid, later uuid, raw text);
insert into ids default values;
grant all on pg_temp.ids to public;

-- ---------------------------------------------------------------- who may
select pg_temp.act_as('00000000-0000-0000-0000-0000000f6004');
select throws_ok($$ select api.admin_ads() $$, '42501', null, 'students cannot manage ads');
select throws_ok($$ select api.begin_ad_upload('media', 'image/jpeg', 1000) $$, '42501', null, 'or upload them');
select pg_temp.act_as('00000000-0000-0000-0000-0000000f6003');
select throws_ok($$ select api.admin_ads() $$, '42501', null, 'nor can moderators');

-- ---------------------------------------------------------------- creating
select pg_temp.act_as('00000000-0000-0000-0000-0000000f6001');
select is((api.admin_ads() ->> 'national'), 'true', 'national admins place ads anywhere');
select throws_ok($$ select api.begin_ad_upload('poster', 'video/mp4', 1000) $$, '22023', null, 'a cover is a photo');
select throws_ok($$ select api.begin_ad_upload('media', 'video/mp4', 30000000) $$, '22023', null, 'videos up to 25 MB');
update ids set raw = api.begin_ad_upload('media', 'image/jpeg', 200000) ->> 'path';
select throws_ok($$ select api.save_ad(jsonb_build_object('name', 'Test', 'sponsor', 'Dialog', 'media_kind', 'image',
    'media_path', (select raw from ids))) $$, '22023', null, 'media is used only after its check');
select throws_ok($$ select api.save_ad(jsonb_build_object('name', 'Video', 'sponsor', 'Dialog', 'media_kind', 'video',
    'media_path', pg_temp.checked_upload('media', 'video/mp4'))) $$, '22023', null, 'a video needs a cover image');
select throws_ok($$ select api.save_ad(jsonb_build_object('name', 'Test', 'sponsor', 'Dialog', 'media_kind', 'image',
    'media_path', pg_temp.checked_upload('media', 'image/jpeg'), 'link_url', 'http://dialog.lk')) $$, '22023', null,
  'links are https only');
update ids set everywhere = (api.save_ad(jsonb_build_object(
  'name', 'Dialog student pack', 'sponsor', 'Dialog', 'headline', 'Unlimited study data', 'body', 'Rs 499 a month for students.',
  'link_url', 'https://dialog.lk/students', 'media_kind', 'video',
  'media_path', pg_temp.checked_upload('media', 'video/mp4'), 'poster_path', pg_temp.checked_upload('poster', 'image/jpeg'),
  'priority', 10)) ->> 'id')::uuid;
select is(pg_temp.cta((select everywhere from ids)), 'Learn more', 'a link gets a button');
update ids set later = (api.save_ad(jsonb_build_object('name', 'Later', 'sponsor', 'Dialog', 'media_kind', 'image',
  'media_path', pg_temp.checked_upload('media', 'image/png'), 'starts_at', now() + interval '3 days')) ->> 'id')::uuid;

select pg_temp.act_as('00000000-0000-0000-0000-0000000f6002');
select throws_ok($$ select api.save_ad(jsonb_build_object('name', 'Everywhere', 'sponsor', 'Cafe', 'media_kind', 'image',
    'media_path', pg_temp.checked_upload('media', 'image/jpeg'))) $$, '42501', null, 'admins of one university cannot place ads everywhere');
update ids set nu = (api.save_ad(jsonb_build_object('name', 'Canteen deal', 'sponsor', 'Nu Canteen', 'media_kind', 'image',
  'media_path', pg_temp.checked_upload('media', 'image/gif'), 'institution_id', 9761)) ->> 'id')::uuid;
select is(jsonb_array_length(api.admin_ads() -> 'ads'), 1, 'and see only their university''s ads');

-- ---------------------------------------------------------------- Home
select pg_temp.act_as('00000000-0000-0000-0000-0000000f6004');
select is(jsonb_array_length(api.home_ads()), 2, 'students see live ads for every university and their own');
select is((api.home_ads() -> 0 ->> 'id')::uuid, (select everywhere from ids), 'highest priority first');
select pg_temp.act_as('00000000-0000-0000-0000-0000000f6005');
select is(jsonb_array_length(api.home_ads()), 1, 'not another university''s');
select pg_temp.act_as('00000000-0000-0000-0000-0000000f6001');
select api.set_ad_active((select everywhere from ids), false);
select pg_temp.act_as('00000000-0000-0000-0000-0000000f6005');
select is(jsonb_array_length(api.home_ads()), 0, 'paused ads stop showing (and scheduled ones have not started)');

-- ---------------------------------------------------------------- numbers
select pg_temp.act_as('00000000-0000-0000-0000-0000000f6004');
select api.ad_event((select nu from ids));
select api.ad_event((select nu from ids));
select api.ad_event((select nu from ids), true);
select pg_temp.act_as('00000000-0000-0000-0000-0000000f6005');
select api.ad_event((select nu from ids), true);
select pg_temp.act_as('00000000-0000-0000-0000-0000000f6002');
select is((api.admin_ads() -> 'ads' -> 0 ->> 'viewers'), '1', 'views are counted once per student per day');
select is((api.admin_ads() -> 'ads' -> 0 ->> 'taps'), '1', 'taps too, and not from students who cannot see it');

select api.delete_ad((select nu from ids));
select set_config('role', 'postgres', true);
select is((select count(*)::int from ops.audit_log where target_id = (select nu from ids)::text), 2, 'creating and deleting are audited');
select is((select count(*)::int from ads.campaigns where id = (select later from ids) and ads.status_of(campaigns) = 'scheduled'), 1,
  'ads that start later are scheduled');

select * from finish();
rollback;
