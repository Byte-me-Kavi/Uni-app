-- Shop: batch merch with pre-orders (reps publish, students order with a slip, reps confirm) and
-- second-hand items from students. Who sees what (also other universities), who manages orders, who
-- reads slips, uploads that belong to someone else, push notifications, interest in items, merch
-- leads for clubs and societies, and listings hidden after reports.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(83);

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9781, 'Test Kappa University', 'TKU', 'state', 'live'),
  (9782, 'Test Lambda University', 'TLU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('kappa.test', 9781), ('lambda.test', 9782);

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
create function pg_temp.listing(p_id uuid) returns shop.listings language sql security definer as $$
  select * from shop.listings where id = p_id;
$$;
create function pg_temp.my_order(p_buyer uuid) returns shop.orders language sql security definer as $$
  select * from shop.orders where buyer_id = p_buyer and status <> 'cancelled';
$$;
create function pg_temp.audits(p_target text) returns integer language sql security definer as $$
  select count(*)::int from ops.audit_log where target_id = p_target;
$$;
create function pg_temp.pushes(p_kind text, p_user uuid default null) returns integer language sql security definer as $$
  select count(*)::int from shop.pushes
  where kind = p_kind and (p_user is null or user_id = p_user) and user_id::text like '00000000-0000-0000-0000-0000000c5%';
$$;
create function pg_temp.app_pushes(p_kind text, p_user uuid) returns integer language sql security definer as $$
  select count(*)::int from messaging.app_pushes where kind = p_kind and user_id = p_user;
$$;
create temp table pdf (path text);
grant all on pg_temp.pdf to public;
create function pg_temp.upload(p_kind text) returns text language sql as $$
  select api.begin_shop_upload(p_kind, 120000) ->> 'path';
$$;

-- r, q: reps of the 2025 batch at Kappa. b: their batchmate. c: Kappa, another batch. z: Lambda.
select pg_temp.make_user('00000000-0000-0000-0000-0000000c5001', '2025kk001@kappa.test', 'Ravi R');
select pg_temp.make_user('00000000-0000-0000-0000-0000000c5002', '2025kk002@kappa.test', 'Qadira Q');
select pg_temp.make_user('00000000-0000-0000-0000-0000000c5003', '2025kk003@kappa.test', 'Bimal B');
select pg_temp.make_user('00000000-0000-0000-0000-0000000c5004', '2024oo001@kappa.test', 'Chamari C');
select pg_temp.make_user('00000000-0000-0000-0000-0000000c5005', '2025kk001@lambda.test', 'Zara Z');
select pg_temp.make_user('00000000-0000-0000-0000-0000000c5006', '2024oo002@kappa.test', 'Dilan D');
select pg_temp.make_user('00000000-0000-0000-0000-0000000c5007', '2024oo003@kappa.test', 'Erandi E');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5001');
select api.join_batch(null, 'BSc in Shop Studies', 2025);
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5002');
select api.join_batch((select id from academics.programmes where institution_id = 9781), null, 2025);
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5003');
select api.join_batch((select id from academics.programmes where institution_id = 9781), null, 2025);
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5004');
select api.join_batch(null, 'BSc in Other Shopping', 2024);
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5006');
select api.join_batch((select id from academics.programmes where institution_id = 9781 and name = 'BSc in Other Shopping'), null, 2024);
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5007');
select api.join_batch((select id from academics.programmes where institution_id = 9781 and name = 'BSc in Other Shopping'), null, 2024);
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5005');
select api.join_batch(null, 'BSc in Shop Studies', 2025);

select set_config('role', 'postgres', true);
update messaging.conversation_members set role = 'admin'
where user_id in ('00000000-0000-0000-0000-0000000c5001', '00000000-0000-0000-0000-0000000c5002')
  and conversation_id = (select c.id from messaging.conversations c join academics.cohort_members m on m.cohort_id = c.cohort_id
                         where m.user_id = '00000000-0000-0000-0000-0000000c5001' and c.kind = 'cohort');
insert into messaging.push_tokens (token, user_id, platform) values
  ('ExponentPushToken[shopr]', '00000000-0000-0000-0000-0000000c5001', 'android'),
  ('ExponentPushToken[shopq]', '00000000-0000-0000-0000-0000000c5002', 'android'),
  ('ExponentPushToken[shopb]', '00000000-0000-0000-0000-0000000c5003', 'android'),
  ('ExponentPushToken[shopc]', '00000000-0000-0000-0000-0000000c5004', 'android');
create temp table ids (merch uuid, shared uuid, club uuid, item uuid, order_id uuid, slip text, photo text, other_photo text, b_photo text);
insert into ids default values;
grant all on pg_temp.ids to public;

-- ---------------------------------------------------------------- publishing merch
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5003');
update ids set b_photo = pg_temp.upload('photo');
select is((api.shop_feed() ->> 'can_post_merch'), 'false', 'students who are not reps cannot publish merch');
select throws_ok($$ select api.save_listing(jsonb_build_object('kind', 'merch', 'title', 'Batch tee', 'price', 1800,
    'photos', jsonb_build_array((select b_photo from ids)), 'closes_at', now() + interval '10 days', 'needs_slip', false)) $$,
  '42501', null, 'and the server refuses them');

select pg_temp.act_as('00000000-0000-0000-0000-0000000c5001');
select is((api.shop_feed() ->> 'can_post_merch'), 'true', 'reps can');
update ids set photo = pg_temp.upload('photo');
select throws_ok($$ select api.save_listing(jsonb_build_object('kind', 'merch', 'title', 'Batch tee', 'price', 1800,
    'photos', jsonb_build_array((select b_photo from ids)), 'closes_at', now() + interval '10 days', 'needs_slip', false)) $$,
  '22023', null, 'nobody can use someone else''s upload');
select throws_ok($$ select api.save_listing(jsonb_build_object('kind', 'merch', 'title', 'Batch tee', 'price', 1800,
    'photos', jsonb_build_array((select photo from ids)), 'closes_at', now() + interval '10 days')) $$,
  '22023', null, 'slips need bank details to pay to');
update ids set merch = (api.save_listing(jsonb_build_object(
  'kind', 'merch', 'title', '  2025 Batch T-shirt ', 'price', 1800, 'audience', 'batch',
  'photos', jsonb_build_array((select photo from ids)), 'size_chart', pg_temp.upload('chart'),
  'sizes', jsonb_build_array('S', 'M', ' L', 'M', 'XL'), 'closes_at', now() + interval '10 days',
  'payment_details', 'BOC 123456, R. Perera', 'collect_details', 'Faculty canteen, Friday')) ->> 'id')::uuid;
select is((pg_temp.listing((select merch from ids))).title, '2025 Batch T-shirt', 'titles are trimmed');
select is((pg_temp.listing((select merch from ids))).sizes, array['S', 'M', 'L', 'XL'], 'sizes are cleaned and kept in order');
select is(pg_temp.audits((select merch from ids)::text), 1,
  'publishing merch is audited');
select is(pg_temp.pushes('merch'), 2, 'the batch hears about new merch (the other rep and the batchmate, not the publisher)');

-- ---------------------------------------------------------------- who sees it
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5003');
select is((api.shop_feed('merch') -> 'listings' -> 0 ->> 'id')::uuid, (select merch from ids), 'batchmates see batch merch');
select is((api.shop_listing((select merch from ids)) ->> 'payment_details'), 'BOC 123456, R. Perera', 'with how to pay');
select ok((select photo from ids) = any (array(select api.media_access(array[(select photo from ids)]))), 'and its photos');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5004');
select is(jsonb_array_length(api.shop_feed('merch') -> 'listings'), 0, 'another batch does not see batch-only merch');
select throws_ok($$ select api.shop_listing((select merch from ids)) $$, '42501', null, 'even by its id');
select is((select count(*)::int from api.media_access(array[(select photo from ids)])), 0, 'or its photos');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5005');
select throws_ok($$ select api.shop_listing((select merch from ids)) $$, '42501', null, 'nor another university');

-- ---------------------------------------------------------------- ordering
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5003');
update ids set slip = pg_temp.upload('slip');
select throws_ok($$ select api.place_order((select merch from ids), '[{"size": "M", "quantity": 1}]', '0771234567') $$,
  '22023', null, 'an order needs the payment slip');
select throws_ok($$ select api.place_order((select merch from ids), '[{"size": "XXL", "quantity": 1}]', '0771234567', null, (select slip from ids)) $$,
  '22023', null, 'only sizes that are listed');
select throws_ok($$ select api.place_order((select merch from ids), '[{"size": "M", "quantity": 1}]', 'call me', null, (select slip from ids)) $$,
  '22023', null, 'and a real phone number');
select throws_ok($$ select api.place_order((select merch from ids), '[{"size": "M", "quantity": "x"}]', '0771234567', null, (select slip from ids)) $$,
  '22023', null, 'quantities are numbers');
select is((api.place_order((select merch from ids), '[{"size": "L", "quantity": 1}, {"size": "M", "quantity": 2}, {"size": "M", "quantity": 1}]',
                           '077 123-4567', 'Name on the back: BIMAL', (select slip from ids)) -> 'my_order' ->> 'total'), '7200',
  'the total is the price times the quantity');
select is((pg_temp.my_order('00000000-0000-0000-0000-0000000c5003')).lines,
  '[{"size": "M", "quantity": 3}, {"size": "L", "quantity": 1}]'::jsonb, 'one line per size, in the listing''s order');
select is((pg_temp.my_order('00000000-0000-0000-0000-0000000c5003')).phone, '0771234567', 'phone numbers are cleaned');
update ids set order_id = (pg_temp.my_order('00000000-0000-0000-0000-0000000c5003')).id;
select is(pg_temp.pushes('order'), 2, 'both reps hear about a new order');
select is((api.place_order((select merch from ids), '[{"size": "S", "quantity": 1}]', '0771234567', null, (select slip from ids)) -> 'my_order' ->> 'id')::uuid,
  (select order_id from ids), 'ordering again changes the same order');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5003');
select ok((select slip from ids) = any (array(select api.media_access(array[(select slip from ids)]))), 'buyers see their own slip');
select is(pg_temp.pushes('order'), 2, 'changing an order does not buzz the reps again');

-- The rep who published it and the batch's other rep both see the orders, with the buyer's details.
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5002');
select is((api.listing_orders((select merch from ids)) -> 'orders' -> 0 -> 'buyer' ->> 'email'), '2025kk003@kappa.test',
  'reps of the batch see who ordered');
select is((api.listing_orders((select merch from ids)) -> 'orders' -> 0 ->> 'phone'), '0771234567', 'and their phone number');
select is((api.listing_orders((select merch from ids)) -> 'sizes' -> 0 ->> 'quantity'), '1', 'and how many of each size');
select ok((select slip from ids) = any (array(select api.media_access(array[(select slip from ids)]))), 'and the slip');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5003');
select throws_ok($$ select api.listing_orders((select merch from ids)) $$, '42501', null, 'buyers do not see other orders');
select throws_ok($$ select api.set_order_status((select order_id from ids), 'paid') $$, '42501', null, 'or confirm their own');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5004');
select is((select count(*)::int from api.media_access(array[(select slip from ids)])), 0, 'nobody else sees a slip');

select pg_temp.act_as('00000000-0000-0000-0000-0000000c5002');
select throws_ok($$ select api.set_order_status((select order_id from ids), 'rejected') $$, '22023', null, 'a rejection says why');
select is((api.set_order_status((select order_id from ids), 'paid') -> 'totals' ->> 'paid'), '1800', 'reps confirm payment');
select is(pg_temp.pushes('order_status', '00000000-0000-0000-0000-0000000c5003'), 1, 'and the buyer hears it');
select is(pg_temp.audits((select order_id from ids)::text), 1, 'which is audited');
select throws_ok($$ select api.save_listing(jsonb_build_object('title', '2025 Batch T-shirt', 'price', 2000,
    'photos', jsonb_build_array((select photo from ids)), 'sizes', jsonb_build_array('S', 'M', 'L', 'XL'),
    'closes_at', (pg_temp.listing((select merch from ids))).closes_at, 'payment_details', 'BOC'), (select merch from ids)) $$,
  '22023', null, 'the price stays once people have ordered');
select throws_ok($$ select api.set_listing_status((select merch from ids), 'removed') $$, '22023', null,
  'merch with orders can be closed, not removed');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5003');
select throws_ok($$ select api.cancel_order((select order_id from ids)) $$, '22023', null, 'a confirmed order cannot be cancelled in the app');
select is((api.my_orders() -> 0 ->> 'status'), 'paid', 'buyers see their order is confirmed');

select pg_temp.act_as('00000000-0000-0000-0000-0000000c5001');
select api.set_listing_status((select merch from ids), 'closed');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5002');
select throws_ok($$ select api.place_order((select merch from ids), '[{"size": "M", "quantity": 1}]', '0771234567', null, pg_temp.upload('slip')) $$,
  '22023', null, 'closed merch takes no orders');

-- ---------------------------------------------------------------- items from students
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5004');
update ids set other_photo = pg_temp.upload('photo');
update ids set item = (api.save_listing(jsonb_build_object(
  'kind', 'item', 'title', 'Casio fx-991ES Plus', 'price', 3500, 'category', 'calculator', 'condition', 'good',
  'photos', jsonb_build_array((select other_photo from ids)), 'contact_phone', '+94 77 765 4321')) ->> 'id')::uuid;
select is((pg_temp.listing((select item from ids))).expires_at::date, (now() + interval '30 days')::date,
  'student listings last 30 days');
select is(pg_temp.pushes('listing'), 3, 'everyone at the university with notifications on hears about a new listing');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5003');
select is((api.shop_feed('item', 'calculator', 'casio') -> 'listings' -> 0 ->> 'id')::uuid, (select item from ids),
  'students at the university find it');
select throws_ok($$ select api.place_order((select item from ids), '[{"quantity": 1}]', '0771234567') $$, '22023', null,
  'items are bought from the seller in person, not ordered');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5005');
select is(jsonb_array_length(api.shop_feed('item') -> 'listings'), 0, 'other universities do not see them');
select is(jsonb_array_length(api.shop_feed('item', null, null, null, 30, 'others') -> 'listings'), 0, 'not even under Other unis');

-- A seller can open a listing to every university.
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5004');
update ids set shared = (api.save_listing(jsonb_build_object(
  'kind', 'item', 'title', 'Drafter set', 'price', 1500, 'category', 'lab', 'condition', 'like_new', 'audience', 'everyone',
  'photos', jsonb_build_array(pg_temp.upload('photo')))) ->> 'id')::uuid;
select is(pg_temp.pushes('listing'), 3, 'at most one new-listing notification every 30 minutes');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5005');
select is((api.shop_feed('all', null, null, null, 30, 'others') -> 'listings' -> 0 ->> 'institution'), 'TKU',
  'other universities see it under Other unis, with the university');
select is(jsonb_array_length(api.shop_feed('all') -> 'listings'), 0, 'not under Your uni');
select throws_ok($$ select api.save_listing(jsonb_build_object('kind', 'item', 'title', 'Old phone', 'price', 100, 'category', 'phone',
    'condition', 'fair', 'audience', 'batch', 'photos', jsonb_build_array(pg_temp.upload('photo')))) $$,
  '22023', null, 'items are for the university or everyone');

-- Interest: the seller is told once and sees who.
select is((api.listing_interest((select shared from ids)) ->> 'interested'), 'true', 'students say they are interested');
select api.listing_interest((select shared from ids));
select is(pg_temp.pushes('interest', '00000000-0000-0000-0000-0000000c5004'), 1, 'the seller is told once');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5004');
select is((api.shop_listing((select shared from ids)) -> 'interests' -> 0 ->> 'name'), 'Zara Z', 'and sees who is interested');
select throws_ok($$ select api.listing_interest((select shared from ids)) $$, '22023', null, 'not in their own listing');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5003');
select is((api.shop_listing((select shared from ids)) -> 'interests'), 'null'::jsonb, 'other students do not see who is interested');
select set_config('role', 'postgres', true);
insert into safety.blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000c5004', '00000000-0000-0000-0000-0000000c5003');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5003');
select throws_ok($$ select api.shop_listing((select item from ids)) $$, '42501', null, 'nor someone the seller blocked');

-- Three students reporting hides it until a moderator looks.
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5004');
select throws_ok($$ select api.report_listing((select item from ids), 'scam') $$, '22023', null, 'sellers cannot report their own');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5002');
select api.report_listing((select item from ids), 'scam');
select api.report_listing((select item from ids), 'scam');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5006');
select api.report_listing((select item from ids), 'spam');
select is((pg_temp.listing((select item from ids))).status, 'open', 'two reports (one student twice) do not hide it');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5007');
select api.report_listing((select item from ids), 'scam');
select is((pg_temp.listing((select item from ids))).status, 'hidden', 'three students do');
select is(pg_temp.app_pushes('listing_hidden', '00000000-0000-0000-0000-0000000c5004'), 1, 'and the seller is told why it left the shop');
select throws_ok($$ select api.shop_listing((select item from ids)) $$, '42501', null, 'and it is gone for students');

-- ---------------------------------------------------------------- merch leads (clubs and societies)
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5003');
select throws_ok($$ select api.appoint_merch_lead('00000000-0000-0000-0000-0000000c5004', 'Rotaract Club') $$, '42501', null,
  'only reps choose merch leads');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5001');
select throws_ok($$ select api.appoint_merch_lead('00000000-0000-0000-0000-0000000c5005', 'Rotaract Club') $$, '22023', null,
  'from their own university');
select is((api.appoint_merch_lead('00000000-0000-0000-0000-0000000c5004', '  Rotaract   Club ') -> 'leads' -> 0 ->> 'club'), 'Rotaract Club',
  'reps make a student the merch lead of a club');
select is(pg_temp.app_pushes('merch_lead', '00000000-0000-0000-0000-0000000c5004'), 1, 'who is told');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5002');
select api.appoint_merch_lead('00000000-0000-0000-0000-0000000c5006', 'rotaract club');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5004');
select is((api.shop_feed() ->> 'merch_club'), 'Rotaract Club', 'merch leads can publish merch for their club');
select throws_ok($$ select api.save_listing(jsonb_build_object('kind', 'merch', 'as', 'club', 'title', 'Rotaract hoodie', 'price', 3200,
    'audience', 'batch', 'photos', jsonb_build_array(pg_temp.upload('photo')), 'closes_at', now() + interval '10 days', 'needs_slip', false)) $$,
  '22023', null, 'for the university or every university, not a batch');
update ids set club = (api.save_listing(jsonb_build_object('kind', 'merch', 'as', 'club', 'title', 'Rotaract hoodie', 'price', 3200,
    'audience', 'university', 'photos', jsonb_build_array(pg_temp.upload('photo')), 'closes_at', now() + interval '10 days',
    'needs_slip', false)) ->> 'id')::uuid;
select is((pg_temp.listing((select club from ids))).club, 'Rotaract Club', 'their merch is from the club');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5007');
select throws_ok($$ select api.begin_shop_upload('photo', 100000, 'application/pdf') $$, '22023', null, 'only a slip can be a PDF');
insert into pdf values (api.begin_shop_upload('slip', 100000, 'application/pdf') ->> 'path');
select throws_ok($$ select api.place_order((select club from ids), '[{"quantity": 1}]', '0771112223', null, (select path from pdf)) $$,
  '22023', null, 'a PDF slip is used only after its check');
select set_config('role', 'postgres', true);
select api.shop_upload_checked((select path from pdf), true);
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5007');
select is((api.place_order((select club from ids), '[{"quantity": 1}]', '0771112223', null, (select path from pdf)) -> 'my_order' ->> 'slip_path'),
  (select path from pdf), 'then it is');
select api.cancel_order((api.shop_listing((select club from ids)) -> 'my_order' ->> 'id')::uuid);
select is(pg_temp.app_pushes('order_cancelled', '00000000-0000-0000-0000-0000000c5004'), 1, 'the merch leads hear when a buyer cancels');
select is((api.place_order((select club from ids), '[{"quantity": 2}]', '0771112223') -> 'my_order' ->> 'total'), '6400',
  'anyone at the university can order it');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5006');
select is(jsonb_array_length(api.listing_orders((select club from ids)) -> 'orders'), 1, 'every merch lead of the club runs its orders');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5001');
select throws_ok($$ select api.listing_orders((select club from ids)) $$, '42501', null, 'batch reps do not');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5003');
select throws_ok($$ select api.remove_merch_lead('00000000-0000-0000-0000-0000000c5004') $$, '42501', null,
  'only the rep who chose a merch lead ends it');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5001');
select is(jsonb_array_length(api.remove_merch_lead('00000000-0000-0000-0000-0000000c5004') -> 'leads'), 1, 'and they can');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c5004');
select throws_ok($$ select api.save_listing(jsonb_build_object('kind', 'merch', 'as', 'club', 'title', 'Rotaract cap', 'price', 900,
    'audience', 'university', 'photos', jsonb_build_array(pg_temp.upload('photo')), 'closes_at', now() + interval '10 days', 'needs_slip', false)) $$,
  '42501', null, 'a former merch lead cannot publish');
select is((api.shop_listing((select club from ids)) ->> 'can_manage'), 'true', 'but still runs what they published');

-- Reminders (hourly): a student listing about to leave the shop tells its seller, once.
select set_config('role', 'postgres', true);
select set_config('request.jwt.claims', '', true);
update shop.listings set expires_at = now() + interval '1 day' where id = (select shared from ids);
select shop.send_reminders();
select shop.send_reminders();
select is(pg_temp.app_pushes('listing_expiring', '00000000-0000-0000-0000-0000000c5004'), 1, 'sellers hear their listing is about to leave the shop');

select * from finish();
rollback;
