-- Shop, part 2: other universities, interest in items, and push notifications.
--
-- Other universities: merch can be for the batch, the university or everyone; items for the
-- university or everyone. The shop tab has "Your uni" and "Other unis"; other universities only show
-- what was opened to everyone.
--
-- Interest: on an item, "I'm interested" tells the seller (a push) and adds the student to the
-- seller's list of interested students, so either can message the other.
--
-- Push notifications (the push Edge Function, channel "shop" on Android, so students can turn shop
-- notifications off without muting chats; quiet hours apply):
--   reps     a new order, or a fixed one after a rejection (at most one per listing every 10 minutes,
--            saying how many are waiting to be checked)
--   buyers   payment confirmed, or the order needs a fix (with the rep's reason)
--   batch    new merch from its reps
--   sellers  a student is interested in their item (at most one per item every 10 minutes)
-- Each event writes rows to shop.pushes with one batch id and asks the push function (pg_net, after
-- the transaction commits) to send that batch; api.shop_push_batch returns the Expo messages.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

alter table shop.listings drop constraint listings_audience_check;
alter table shop.listings add constraint listings_audience_check check (audience in ('batch', 'university', 'everyone'));
-- Part 1's unnamed check assumed 'university' was the only audience without a batch.
do $$
declare
  v_name text;
begin
  select c.conname into v_name from pg_constraint c
  where c.conrelid = 'shop.listings'::regclass and pg_get_constraintdef(c.oid) like '%cohort_id IS NOT NULL%';
  execute format('alter table shop.listings drop constraint %I', v_name);
end;
$$;
alter table shop.listings add constraint listings_batch_has_cohort check (audience <> 'batch' or cohort_id is not null);
-- The "Other unis" feed: everything open to everyone, newest first.
create index listings_everyone_idx on shop.listings (created_at desc) where audience = 'everyone' and status = 'open';

create table shop.interests (
  listing_id uuid not null references shop.listings (id) on delete cascade,
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);
create index interests_user_idx on shop.interests (user_id);
alter table shop.interests enable row level security;

create table shop.pushes (
  id uuid primary key default ops.uuid_v7(),
  batch_id uuid not null,
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  listing_id uuid not null references shop.listings (id) on delete cascade,
  kind text not null check (kind in ('order', 'order_status', 'merch', 'interest')),
  title text not null check (char_length(title) <= 80),
  body text not null check (char_length(body) <= 180),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index pushes_batch_idx on shop.pushes (batch_id);
create index pushes_recent_idx on shop.pushes (user_id, listing_id, kind, created_at desc);
create index pushes_listing_idx on shop.pushes (listing_id);
alter table shop.pushes enable row level security;
-- No grants or policies: through the functions below.

-- ---------------------------------------------------------------------------------------------
-- Who sees a listing (adds 'everyone')
-- ---------------------------------------------------------------------------------------------

create or replace function shop.can_see(p shop.listings)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    shop.can_manage(p)
    or exists (select 1 from shop.orders o where o.listing_id = p.id and o.buyer_id = (select auth.uid()) and o.status <> 'cancelled')
    or (p.status in ('open', 'closed', 'sold')
        and (select identity.current_institution_id()) is not null
        and (p.audience = 'everyone'
             or (p.institution_id = (select identity.current_institution_id())
                 and (p.audience = 'university'
                      or exists (select 1 from academics.cohort_members m where m.cohort_id = p.cohort_id and m.user_id = (select auth.uid())))))
        and (p.expires_at is null or p.expires_at > now())
        and not exists (select 1 from safety.blocks b
                        where (b.blocker_id = p.seller_id and b.blocked_id = (select auth.uid()))
                           or (b.blocker_id = (select auth.uid()) and b.blocked_id = p.seller_id))));
$$;

-- The seller and, for merch, the batch's current reps: who hears about orders.
create or replace function shop.managers(p shop.listings)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    select p.seller_id
    union
    select m.user_id from messaging.conversations c
    join messaging.conversation_members m on m.conversation_id = c.id
    where p.kind = 'merch' and c.cohort_id = p.cohort_id and c.kind = 'cohort' and m.role = 'admin');
$$;

-- ---------------------------------------------------------------------------------------------
-- Push notifications
-- ---------------------------------------------------------------------------------------------

-- Queues one notification to each student (never the one acting), skipping those with no phone
-- registered, in quiet hours, or (orders and interest) told about this listing in the last 10 minutes.
create or replace function shop.notify(p_users uuid[], p_listing_id uuid, p_kind text, p_title text, p_body text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_batch uuid := ops.uuid_v7();
  v_url text;
  v_secret text;
begin
  insert into shop.pushes (batch_id, user_id, listing_id, kind, title, body)
  select v_batch, x.u, p_listing_id, p_kind, left(p_title, 80), left(coalesce(p_body, ''), 180)
  from (select distinct unnest(p_users) as u) x
  where x.u is not null and x.u is distinct from (select auth.uid())
    and exists (select 1 from messaging.push_tokens t where t.user_id = x.u)
    and exists (select 1 from identity.profiles pr where pr.user_id = x.u and pr.account_status = 'active')
    and not messaging.in_quiet_hours(x.u)
    and (p_kind not in ('order', 'interest') or not exists (
          select 1 from shop.pushes s
          where s.user_id = x.u and s.listing_id = p_listing_id and s.kind = p_kind and s.created_at > now() - interval '10 minutes'));
  if not found then
    return;
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'push_function_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'push_function_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('shop_batch', v_batch),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 10000
  );
end;
$$;

-- The Expo messages for one batch (only the push function, with the service role, calls this).
-- On Android each listing has one shop notification per kind, replaced by the next.
create or replace function api.shop_push_batch(p_batch_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  with sent as (
    update shop.pushes p set sent_at = now()
    where p.batch_id = p_batch_id and p.sent_at is null and p.created_at > now() - interval '10 minutes'
    returning p.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'to', t.token,
    'title', s.title,
    'body', s.body,
    'data', jsonb_build_object('shop', s.kind, 'listing_id', s.listing_id, 'badge', messaging.unread_total(s.user_id)),
    'badge', messaging.unread_total(s.user_id),
    'channelId', 'shop',
    'tag', s.listing_id::text || ':' || s.kind,
    'threadId', 'shop:' || s.listing_id::text,
    'sound', 'default',
    'priority', 'high',
    'ttl', 86400
  )), '[]'::jsonb)
  into v_result
  from sent s
  join messaging.push_tokens t on t.user_id = s.user_id;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Listings for the caller (adds the university, interest)
-- ---------------------------------------------------------------------------------------------

create or replace function shop.listing_json(p shop.listings, p_full boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'kind', p.kind,
    'title', p.title,
    'price', p.price,
    'category', p.category,
    'condition', p.condition,
    'photo', p.photos[1],
    'status', p.status,
    'audience', p.audience,
    'ordering', shop.ordering_open(p),
    'closes_at', p.closes_at,
    'expires_at', p.expires_at,
    'created_at', p.created_at,
    'mine', p.seller_id = (select auth.uid()),
    'batch', case when p.cohort_id is not null then academics.batch_name(p.cohort_id) end,
    'institution', (select coalesce(i.short_name, i.name) from identity.institutions i where i.id = p.institution_id),
    -- Listed at another university (open to all universities).
    'other', p.institution_id is distinct from (select identity.current_institution_id()),
    'seller', (select jsonb_build_object('id', s.user_id, 'name', s.full_name, 'avatar_path', s.avatar_path)
               from identity.profiles s where s.user_id = p.seller_id),
    'my_order', (select jsonb_build_object('id', o.id, 'status', o.status, 'quantity', o.quantity)
                 from shop.orders o where o.listing_id = p.id and o.buyer_id = (select auth.uid()) and o.status <> 'cancelled'))
  || case when p_full then jsonb_build_object(
       'description', p.description,
       'photos', to_jsonb(p.photos),
       'size_chart', p.size_chart,
       'sizes', to_jsonb(p.sizes),
       'payment_details', p.payment_details,
       'collect_details', p.collect_details,
       'needs_slip', p.needs_slip,
       'contact_phone', p.contact_phone,
       'can_manage', shop.can_manage(p),
       'has_orders', exists (select 1 from shop.orders o where o.listing_id = p.id and o.status <> 'cancelled'),
       'orders', case when shop.can_manage(p) then (
         select jsonb_build_object('count', count(*), 'to_check', count(*) filter (where o.status = 'placed'),
                                   'quantity', coalesce(sum(o.quantity), 0))
         from shop.orders o where o.listing_id = p.id and o.status <> 'cancelled') end,
       'my_order', (select shop.order_json(o, false) from shop.orders o
                    where o.listing_id = p.id and o.buyer_id = (select auth.uid()) and o.status <> 'cancelled'),
       -- The number the student gave last time, to fill in the order form.
       'my_phone', (select o.phone from shop.orders o where o.buyer_id = (select auth.uid()) order by o.created_at desc limit 1),
       'interested', exists (select 1 from shop.interests x where x.listing_id = p.id and x.user_id = (select auth.uid())),
       -- Items: the students who said they are interested, for the seller only.
       'interests', case when p.kind = 'item' and p.seller_id = (select auth.uid()) then coalesce((
         select jsonb_agg(jsonb_build_object('id', s.user_id, 'name', s.full_name, 'avatar_path', s.avatar_path,
                                             'batch', (select academics.batch_name(m.cohort_id) from academics.cohort_members m
                                                       where m.user_id = s.user_id limit 1),
                                             'at', x.created_at) order by x.created_at desc)
         from (select * from shop.interests y where y.listing_id = p.id order by y.created_at desc limit 50) x
         join identity.profiles s on s.user_id = x.user_id), '[]'::jsonb) end)
     else '{}'::jsonb end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The shop tab: "Your uni" and "Other unis"
-- ---------------------------------------------------------------------------------------------

-- Newest first. p_scope 'mine': what is on sale at the caller's university (and their batch's merch);
-- 'others': what other universities opened to everyone. p_filter: 'all', 'merch' or 'item'.
-- p_before: the created_at of the last card, for the next page.
drop function api.shop_feed(text, text, text, timestamptz, integer);
create or replace function api.shop_feed(
  p_filter text default 'all',
  p_category text default null,
  p_query text default null,
  p_before timestamptz default null,
  p_limit integer default 30,
  p_scope text default 'mine'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint := (select identity.current_institution_id());
  v_cohort bigint;
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_like text;
begin
  if v_uid is null or v_institution is null then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if coalesce(p_filter, 'all') not in ('all', 'merch', 'item') or coalesce(p_scope, 'mine') not in ('mine', 'others') then
    raise exception 'Unknown filter.' using errcode = '22023';
  end if;
  select c.id into v_cohort from academics.my_cohort() c;
  if v_query is not null then
    v_like := '%' || replace(replace(replace(left(v_query, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return jsonb_build_object(
    'can_post_merch', shop.is_rep(v_cohort),
    'listings', coalesce((
      select jsonb_agg(shop.listing_json(l, false) order by l.created_at desc)
      from shop.listings l
      where l.id in (
        select x.id from shop.listings x
        where x.status = 'open'
          and case when coalesce(p_scope, 'mine') = 'mine'
                then x.institution_id = v_institution and (x.audience in ('university', 'everyone') or x.cohort_id = v_cohort)
                else x.institution_id <> v_institution and x.audience = 'everyone' end
          and (x.expires_at is null or x.expires_at > now())
          and (x.closes_at is null or x.closes_at > now())
          and (coalesce(p_filter, 'all') = 'all' or x.kind = p_filter)
          and (p_category is null or x.category = p_category)
          and (v_like is null or x.title ilike v_like or x.description ilike v_like)
          and (p_before is null or x.created_at < p_before)
          and not exists (select 1 from safety.blocks b
                          where (b.blocker_id = x.seller_id and b.blocked_id = v_uid)
                             or (b.blocker_id = v_uid and b.blocked_id = x.seller_id))
        order by x.created_at desc
        limit v_limit)), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Selling (audience 'everyone'; the batch hears about new merch)
-- ---------------------------------------------------------------------------------------------

-- Creates (no p_listing_id) or edits a listing. p_listing:
--   kind            'merch' (batch reps) or 'item' (any student); fixed once created
--   title, description, price (rupees), photos (1 to 6 upload paths)
--   audience        merch: 'batch', 'university' or 'everyone'; item: 'university' or 'everyone'
--   merch: sizes (up to 12, e.g. ["S","M","L"]), size_chart (upload path), closes_at,
--          payment_details, collect_details, needs_slip
--   item:  category, condition, contact_phone (optional)
-- Once people have ordered, the price stays and sizes can only be added.
create or replace function api.save_listing(p_listing jsonb, p_listing_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old shop.listings;
  v_cohort bigint;
  v_kind text;
  v_title text := btrim(coalesce(p_listing ->> 'title', ''));
  v_description text := nullif(btrim(coalesce(p_listing ->> 'description', '')), '');
  v_price integer;
  v_category text;
  v_condition text;
  v_photos text[];
  v_chart text := nullif(p_listing ->> 'size_chart', '');
  v_sizes text[] := '{}';
  v_closes timestamptz;
  v_audience text := coalesce(p_listing ->> 'audience', 'university');
  v_payment text := nullif(btrim(coalesce(p_listing ->> 'payment_details', '')), '');
  v_collect text := nullif(btrim(coalesce(p_listing ->> 'collect_details', '')), '');
  v_slip boolean := coalesce((p_listing ->> 'needs_slip')::boolean, true);
  v_phone text;
  v_id uuid;
  v_row shop.listings;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_listing is null or jsonb_typeof(p_listing) <> 'object' then
    raise exception 'Fill in the listing.' using errcode = '22023';
  end if;

  if p_listing_id is not null then
    select * into v_old from shop.listings l where l.id = p_listing_id for update;
    if v_old.id is null or not shop.can_manage(v_old) then
      raise exception 'This listing is not available.' using errcode = '42501';
    end if;
    if v_old.status in ('removed', 'hidden') then
      raise exception 'This listing can no longer be changed.' using errcode = '22023';
    end if;
    v_kind := v_old.kind;
  else
    v_kind := p_listing ->> 'kind';
  end if;
  if v_kind is null or v_kind not in ('merch', 'item') then
    raise exception 'Choose what you are listing.' using errcode = '22023';
  end if;

  if char_length(v_title) < 3 or char_length(v_title) > 80 then
    raise exception 'Give it a name of 3 to 80 characters.' using errcode = '22023';
  end if;
  if v_description is not null and char_length(v_description) > 2000 then
    raise exception 'Keep the description under 2,000 characters.' using errcode = '22023';
  end if;
  if coalesce(p_listing ->> 'price', '') !~ '^[0-9]{1,8}$' then
    raise exception 'Enter the price in rupees.' using errcode = '22023';
  end if;
  v_price := (p_listing ->> 'price')::integer;
  if v_price > 10000000 then
    raise exception 'Enter the price in rupees.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_listing -> 'photos') is distinct from 'array' then
    raise exception 'Add at least one photo.' using errcode = '22023';
  end if;
  select coalesce(array_agg(x order by n), '{}') into v_photos
  from jsonb_array_elements_text(p_listing -> 'photos') with ordinality t(x, n);
  if cardinality(v_photos) < 1 or cardinality(v_photos) > 6 then
    raise exception 'Add 1 to 6 photos.' using errcode = '22023';
  end if;

  if v_kind = 'merch' then
    select c.id into v_cohort from academics.my_cohort() c;
    if p_listing_id is null and not shop.is_rep(v_cohort) then
      raise exception 'Batch reps publish merch for their batch.' using errcode = '42501';
    end if;
    v_cohort := coalesce(v_old.cohort_id, v_cohort);
    if v_price < 1 then
      raise exception 'Enter the price in rupees.' using errcode = '22023';
    end if;
    if p_listing ? 'sizes' then
      if jsonb_typeof(p_listing -> 'sizes') <> 'array' then
        raise exception 'Choose the sizes.' using errcode = '22023';
      end if;
      select coalesce(array_agg(s order by n), '{}') into v_sizes
      from (select btrim(x) as s, min(n) as n from jsonb_array_elements_text(p_listing -> 'sizes') with ordinality t(x, n)
            where btrim(x) <> '' group by btrim(x)) z;
    end if;
    if cardinality(v_sizes) > 12 or exists (select 1 from unnest(v_sizes) s where char_length(s) > 12) then
      raise exception 'Up to 12 sizes, each up to 12 characters.' using errcode = '22023';
    end if;
    begin
      v_closes := (p_listing ->> 'closes_at')::timestamptz;
    exception when others then
      v_closes := null;
    end;
    if v_closes is null then
      raise exception 'Choose the last day to order.' using errcode = '22023';
    end if;
    if (v_old.id is null or v_closes <> v_old.closes_at) and (v_closes < now() + interval '1 hour' or v_closes > now() + interval '180 days') then
      raise exception 'Orders can close from an hour to six months from now.' using errcode = '22023';
    end if;
    if v_audience not in ('batch', 'university', 'everyone') then
      raise exception 'Choose who can order.' using errcode = '22023';
    end if;
    if v_slip and v_payment is null then
      raise exception 'Add the bank details buyers pay to, or turn off payment slips.' using errcode = '22023';
    end if;
    if v_payment is not null and char_length(v_payment) > 500 then
      raise exception 'Keep the payment details under 500 characters.' using errcode = '22023';
    end if;
    if v_collect is not null and char_length(v_collect) > 300 then
      raise exception 'Keep the collection details under 300 characters.' using errcode = '22023';
    end if;
    v_category := 'merch';
    if v_chart is not null then
      perform shop.check_listing_uploads(p_listing_id, 'chart', array[v_chart]);
    end if;
    if v_old.id is not null and exists (select 1 from shop.orders o where o.listing_id = v_old.id and o.status <> 'cancelled')
       and (v_price <> v_old.price or not (v_old.sizes <@ v_sizes)) then
      raise exception 'People have ordered already: the price stays the same and sizes can only be added.' using errcode = '22023';
    end if;
  else
    v_category := coalesce(p_listing ->> 'category', 'other');
    if v_category not in ('calculator', 'laptop', 'phone', 'book', 'lab', 'electronics', 'other') then
      raise exception 'Choose a category.' using errcode = '22023';
    end if;
    v_condition := p_listing ->> 'condition';
    if v_condition is null or v_condition not in ('new', 'like_new', 'good', 'fair') then
      raise exception 'Choose its condition.' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_listing ->> 'contact_phone', '')), '') is not null then
      v_phone := shop.clean_phone(p_listing ->> 'contact_phone');
      if v_phone is null then
        raise exception 'Enter a phone number like 0771234567, or leave it empty.' using errcode = '22023';
      end if;
    end if;
    if v_audience not in ('university', 'everyone') then
      raise exception 'Choose who can see it.' using errcode = '22023';
    end if;
    v_chart := null;
    v_payment := null;
    v_collect := null;
  end if;
  perform shop.check_listing_uploads(p_listing_id, 'photo', v_photos);

  if v_old.id is null then
    perform messaging.hit_limit('shop_listing', 10, 'You have listed a lot today. Try again tomorrow.');
    insert into shop.listings (kind, seller_id, institution_id, cohort_id, audience, title, description, price, category,
                               condition, photos, size_chart, sizes, closes_at, payment_details, collect_details, needs_slip,
                               contact_phone, expires_at)
    values (v_kind, v_uid, (select identity.current_institution_id()), case when v_kind = 'merch' then v_cohort end, v_audience,
            v_title, v_description, v_price, v_category, v_condition, v_photos, v_chart, v_sizes,
            case when v_kind = 'merch' then v_closes end, v_payment, v_collect, v_kind <> 'merch' or v_slip, v_phone,
            case when v_kind = 'item' then now() + interval '30 days' end)
    returning * into v_row;
  else
    perform messaging.hit_limit('shop_edit', 60, 'You have changed listings a lot today. Try again tomorrow.');
    update shop.listings l set
      title = v_title, description = v_description, price = v_price, category = v_category, condition = v_condition,
      photos = v_photos, size_chart = v_chart, sizes = v_sizes, closes_at = case when v_kind = 'merch' then v_closes end,
      audience = v_audience, payment_details = v_payment, collect_details = v_collect,
      needs_slip = v_kind <> 'merch' or v_slip, contact_phone = v_phone,
      -- Moving the closing date later reopens orders.
      status = case when l.kind = 'merch' and l.status = 'closed' and v_closes > now() and v_closes <> l.closes_at then 'open' else l.status end
    where l.id = v_old.id
    returning * into v_row;
  end if;
  perform shop.link_listing_uploads(v_row.id, 'photo', v_photos);
  perform shop.link_listing_uploads(v_row.id, 'chart', case when v_chart is null then '{}'::text[] else array[v_chart] end);

  -- New merch: the batch hears about it (students can turn Shop notifications off on their phone).
  if v_kind = 'merch' and v_old.id is null then
    perform shop.notify(
      array(select m.user_id from academics.cohort_members m where m.cohort_id = v_cohort),
      v_row.id, 'merch', 'New merch from your reps',
      v_title || ' · Rs ' || to_char(v_price, 'FM9,999,999') || '. Order by '
        || to_char(v_closes at time zone 'Asia/Colombo', 'Dy DD Mon') || '.');
  end if;

  if v_kind = 'merch' then
    insert into ops.audit_log (actor_id, action, target_table, target_id, details)
    values (v_uid, case when v_old.id is null then 'shop.merch_created' else 'shop.merch_changed' end, 'shop.listings', v_row.id::text,
            jsonb_build_object('title', v_title, 'price', v_price, 'sizes', v_sizes, 'closes_at', v_closes,
                               'payment_details', v_payment, 'cohort_id', v_cohort));
  end if;
  return shop.listing_json(v_row, true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Ordering (the reps and the buyer hear about it)
-- ---------------------------------------------------------------------------------------------

-- Places the caller's order, or changes it while no rep has confirmed it (a rejected order goes back
-- to the reps). p_lines: [{ "size": "M", "quantity": 2 }] (size null when the item has no sizes).
create or replace function api.place_order(
  p_listing_id uuid,
  p_lines jsonb,
  p_phone text,
  p_note text default null,
  p_slip_path text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v shop.listings;
  v_old shop.orders;
  v_lines jsonb;
  v_quantity integer;
  v_phone text := shop.clean_phone(p_phone);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_slip text := nullif(p_slip_path, '');
  v_order uuid;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v := shop.visible_listing(p_listing_id);
  if v.kind <> 'merch' then
    raise exception 'Message the seller to buy this.' using errcode = '22023';
  end if;
  if not shop.ordering_open(v) then
    raise exception 'Orders for this have closed.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 12 then
    raise exception 'Choose a size and how many.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) x
             where jsonb_typeof(x) <> 'object'
                or case when coalesce(x ->> 'quantity', '') ~ '^[0-9]{1,2}$' then (x ->> 'quantity')::integer else 0 end
                   not between 1 and 20) then
    raise exception 'Order 1 to 20 of each size.' using errcode = '22023';
  end if;
  if cardinality(v.sizes) > 0 then
    if exists (select 1 from jsonb_array_elements(p_lines) x where not (coalesce(x ->> 'size', '') = any (v.sizes))) then
      raise exception 'Choose one of the sizes listed.' using errcode = '22023';
    end if;
  elsif exists (select 1 from jsonb_array_elements(p_lines) x where nullif(x ->> 'size', '') is not null) then
    raise exception 'This has no sizes.' using errcode = '22023';
  end if;
  -- One line per size, in the listing's order.
  select jsonb_agg(jsonb_build_object('size', s, 'quantity', q) order by array_position(v.sizes, s)), sum(q)
  into v_lines, v_quantity
  from (select nullif(x ->> 'size', '') as s, sum((x ->> 'quantity')::integer)::integer as q
        from jsonb_array_elements(p_lines) x group by 1) z;
  if v_quantity > 50 then
    raise exception 'Up to 50 in one order. Ask a rep for bulk orders.' using errcode = '22023';
  end if;
  if v_phone is null then
    raise exception 'Enter your phone number, like 0771234567, so the reps can reach you.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'Keep the note under 300 characters.' using errcode = '22023';
  end if;

  select * into v_old from shop.orders o
  where o.listing_id = v.id and o.buyer_id = v_uid and o.status <> 'cancelled' for update;
  if v_old.status in ('paid', 'collected') then
    raise exception 'A rep has confirmed your order. Message them to change it.' using errcode = '22023';
  end if;
  if v.needs_slip and v_slip is null then
    raise exception 'Add a photo of your payment slip.' using errcode = '22023';
  end if;
  if v_slip is not null and not exists (
       select 1 from shop.uploads u
       where u.path = v_slip and u.user_id = v_uid and u.kind = 'slip' and u.listing_id is null
         and (u.order_id is null or u.order_id = v_old.id)) then
    raise exception 'Your slip did not finish uploading. Add it again.' using errcode = '22023';
  end if;

  if v_old.id is null then
    perform messaging.hit_limit('shop_order', 30, 'You have placed a lot of orders today. Try again tomorrow.');
    insert into shop.orders (listing_id, buyer_id, lines, quantity, total, phone, note, slip_path)
    values (v.id, v_uid, v_lines, v_quantity, v.price * v_quantity, v_phone, v_note, v_slip)
    returning id into v_order;
  else
    perform messaging.hit_limit('shop_order_edit', 60, 'You have changed orders a lot today. Try again tomorrow.');
    update shop.orders o set lines = v_lines, quantity = v_quantity, total = v.price * v_quantity, phone = v_phone,
      note = v_note, slip_path = v_slip, status = 'placed', status_note = null, status_by = null
    where o.id = v_old.id;
    v_order := v_old.id;
    update shop.uploads u set order_id = null where u.order_id = v_order and u.path is distinct from v_slip;
  end if;
  if v_slip is not null then
    update shop.uploads u set order_id = v_order where u.path = v_slip;
  end if;

  -- The reps hear about new orders and fixed ones (at most one push per listing every 10 minutes,
  -- saying how many are waiting).
  if v_old.id is null or v_old.status = 'rejected' then
    perform shop.notify(
      shop.managers(v), v.id, 'order',
      case when v_old.id is null then 'New order: ' else 'Fixed order: ' end || v.title,
      split_part((select p.full_name from identity.profiles p where p.user_id = v_uid), ' ', 1)
        || case when v_old.id is null then ' ordered ' else ' sent a new slip for ' end
        || (select string_agg(case when l ->> 'size' is null then l ->> 'quantity'
                                   else (l ->> 'quantity') || ' × ' || (l ->> 'size') end, ', ')
            from jsonb_array_elements(v_lines) l)
        || ' · Rs ' || to_char(v.price * v_quantity, 'FM9,999,999') || '. '
        || (select count(*) from shop.orders o where o.listing_id = v.id and o.status = 'placed') || ' to check.');
  end if;
  return shop.listing_json(v, true);
end;
$$;

-- p_status: 'paid' (slip checked), 'rejected' (with a reason the buyer sees), 'collected', or
-- 'placed' (undo).
create or replace function api.set_order_status(p_order_id uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_order shop.orders;
  v shop.listings;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v_order from shop.orders o where o.id = p_order_id for update;
  select * into v from shop.listings l where l.id = v_order.listing_id;
  if v_order.id is null or v_order.status = 'cancelled' or not shop.can_manage(v) then
    raise exception 'This order is not available.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('placed', 'paid', 'rejected', 'collected') then
    raise exception 'Unknown change.' using errcode = '22023';
  end if;
  if p_status = 'rejected' and v_note is null then
    raise exception 'Say why, so the buyer can fix it.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'Keep the reason under 200 characters.' using errcode = '22023';
  end if;
  perform messaging.hit_limit('shop_order_status', 1000, 'You have updated a lot of orders today. Try again tomorrow.');
  update shop.orders o set status = p_status, status_note = case when p_status = 'rejected' then v_note end, status_by = v_uid
  where o.id = v_order.id;
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_uid, 'shop.order_status', 'shop.orders', v_order.id::text,
          jsonb_build_object('listing_id', v.id, 'from', v_order.status, 'to', p_status, 'note', v_note));
  -- The buyer hears when their payment is confirmed or needs a fix.
  if p_status in ('paid', 'rejected') and p_status is distinct from v_order.status then
    perform shop.notify(
      array[v_order.buyer_id], v.id, 'order_status',
      case when p_status = 'paid' then 'Payment confirmed' else 'Your order needs a fix' end,
      v.title || ': ' || case when p_status = 'paid'
        then split_part((select p.full_name from identity.profiles p where p.user_id = v_uid), ' ', 1) || ' confirmed your order.'
        else v_note end);
  end if;
  return api.listing_orders(v.id);
end;
$$;


-- ---------------------------------------------------------------------------------------------
-- Interest in an item
-- ---------------------------------------------------------------------------------------------

-- "I'm interested": the seller is told and sees the student in their list. Saying it again does
-- nothing new.
create or replace function api.listing_interest(p_listing_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v shop.listings;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v := shop.visible_listing(p_listing_id);
  if v.kind <> 'item' or v.status <> 'open' then
    raise exception 'This is no longer for sale.' using errcode = '22023';
  end if;
  if v.seller_id = v_uid then
    raise exception 'This is your listing.' using errcode = '22023';
  end if;
  insert into shop.interests (listing_id, user_id) values (v.id, v_uid) on conflict do nothing;
  if found then
    perform messaging.hit_limit('shop_interest', 50, 'You have shown interest in a lot today. Message the sellers instead.');
    perform shop.notify(
      array[v.seller_id], v.id, 'interest', 'Someone wants your ' || v.title,
      (select p.full_name from identity.profiles p where p.user_id = v_uid)
        || coalesce(' (' || (select coalesce(i.short_name, i.name) from identity.profiles p join identity.institutions i on i.id = p.institution_id
                             where p.user_id = v_uid and p.institution_id <> v.institution_id) || ')', '')
        || ' is interested. Open it to message them.');
  end if;
  return shop.listing_json(v, true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------

revoke execute on function shop.managers(shop.listings) from public, anon, authenticated;
revoke execute on function shop.notify(uuid[], uuid, text, text, text) from public, anon, authenticated;
revoke execute on function shop.can_see(shop.listings) from public, anon, authenticated;
revoke execute on function shop.listing_json(shop.listings, boolean) from public, anon, authenticated;

revoke execute on function api.shop_push_batch(uuid) from public, anon, authenticated;
grant execute on function api.shop_push_batch(uuid) to service_role;

revoke execute on function api.shop_feed(text, text, text, timestamptz, integer, text) from public, anon;
grant execute on function api.shop_feed(text, text, text, timestamptz, integer, text) to authenticated;
revoke execute on function api.listing_interest(uuid) from public, anon;
grant execute on function api.listing_interest(uuid) to authenticated;
