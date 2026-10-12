-- Shop: batch merch with pre-orders, and second-hand items from students.
--
-- Merch: batch reps (admins of their batch group) publish a T-shirt, hoodie or similar, with
-- photos, sizes, an optional size chart, a price, the last day to order, how to pay (bank details
-- for the slip) and how buyers collect. Students pre-order: sizes and quantities, their phone
-- number (for delivery), a note and their payment slip. The reps of that batch see every order with
-- the buyer's name, batch, email and phone, check the slips and mark orders paid, rejected (with a
-- reason) or collected. This replaces the Google Form plus slip upload.
--
-- Items: any student lists a calculator, laptop, phone, book or lab gear for students at their
-- university. Nothing is paid through the app: buyers message the seller (or call, if the seller
-- shows a number) and meet in person. Item listings expire after 30 days unless renewed.
--
-- Photos, size charts and slips live in the private bucket (the media function), under
-- shop/<user>/<id>.jpg. api.begin_shop_upload records each upload against the student; a listing or
-- order only accepts the student's own uploads. Photos are readable by whoever can see the listing;
-- a slip only by the buyer and the reps who manage that listing (api.media_access).
--
-- Safety: reports on every listing; three students reporting hides it until a moderator looks.

create schema if not exists shop;
grant usage on schema shop to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table shop.listings (
  id uuid primary key default ops.uuid_v7(),
  kind text not null check (kind in ('merch', 'item')),
  seller_id uuid not null references identity.profiles (user_id) on delete cascade,
  institution_id bigint not null references identity.institutions (id) on delete cascade,
  -- Merch: the rep's batch. Its reps manage the listing together.
  cohort_id bigint references academics.cohorts (id) on delete set null,
  -- 'batch': only that batch sees it. 'university': everyone at the university.
  audience text not null default 'university' check (audience in ('batch', 'university')),
  title text not null check (char_length(title) between 3 and 80),
  description text check (char_length(description) <= 2000),
  -- Sri Lankan rupees, whole.
  price integer not null check (price between 0 and 10000000),
  category text not null default 'other'
    check (category in ('merch', 'calculator', 'laptop', 'phone', 'book', 'lab', 'electronics', 'other')),
  condition text check (condition in ('new', 'like_new', 'good', 'fair')),
  photos text[] not null check (cardinality(photos) between 1 and 6),
  size_chart text,
  sizes text[] not null default '{}' check (cardinality(sizes) <= 12),
  -- Merch: the last moment to order.
  closes_at timestamptz,
  payment_details text check (char_length(payment_details) <= 500),
  collect_details text check (char_length(collect_details) <= 300),
  needs_slip boolean not null default true,
  -- Items: a number the seller chose to show.
  contact_phone text check (char_length(contact_phone) <= 20),
  -- open: on sale. closed: merch no longer taking orders. sold: item sold. removed: by the seller.
  -- hidden: reported by several students, waiting for a moderator.
  status text not null default 'open' check (status in ('open', 'closed', 'sold', 'removed', 'hidden')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (audience = 'university' or cohort_id is not null),
  check (kind = 'item' or closes_at is not null)
);
create index listings_feed_idx on shop.listings (institution_id, status, created_at desc);
create index listings_cohort_idx on shop.listings (cohort_id);
create index listings_seller_idx on shop.listings (seller_id, created_at desc);
create trigger listings_touch before update on shop.listings
  for each row execute function ops.touch_updated_at();
alter table shop.listings enable row level security;

create table shop.orders (
  id uuid primary key default ops.uuid_v7(),
  listing_id uuid not null references shop.listings (id) on delete cascade,
  buyer_id uuid not null references identity.profiles (user_id) on delete cascade,
  -- [{ "size": "M" | null, "quantity": 2 }], in the listing's size order.
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  quantity integer not null check (quantity between 1 and 50),
  -- Price times quantity when ordered, in rupees.
  total integer not null check (total >= 0),
  phone text not null check (char_length(phone) between 9 and 16),
  note text check (char_length(note) <= 300),
  slip_path text,
  -- placed: waiting for a rep. paid: the rep checked the slip. rejected: the rep says why.
  -- collected: handed over. cancelled: by the buyer.
  status text not null default 'placed' check (status in ('placed', 'paid', 'rejected', 'collected', 'cancelled')),
  status_note text check (char_length(status_note) <= 200),
  status_by uuid references identity.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One live order per student per listing (they change it instead of ordering twice).
create unique index orders_one_live_idx on shop.orders (listing_id, buyer_id) where status <> 'cancelled';
create index orders_listing_idx on shop.orders (listing_id, created_at);
create index orders_buyer_idx on shop.orders (buyer_id, created_at desc);
create index orders_status_by_idx on shop.orders (status_by);
create trigger orders_touch before update on shop.orders
  for each row execute function ops.touch_updated_at();
alter table shop.orders enable row level security;

create table shop.uploads (
  path text primary key,
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  kind text not null check (kind in ('photo', 'chart', 'slip')),
  size integer not null check (size > 0),
  -- Set when a listing or order uses it; uploads never used can be cleaned up.
  listing_id uuid references shop.listings (id) on delete set null,
  order_id uuid references shop.orders (id) on delete set null,
  created_at timestamptz not null default now()
);
create index uploads_user_idx on shop.uploads (user_id, created_at desc);
create index uploads_listing_idx on shop.uploads (listing_id);
create index uploads_order_idx on shop.uploads (order_id);
alter table shop.uploads enable row level security;
-- No grants or policies: everything goes through the api functions below.

alter table safety.reports drop constraint if exists reports_target_kind_check;
alter table safety.reports add constraint reports_target_kind_check
  check (target_kind in ('profile', 'message', 'resource', 'kuppi', 'conversation', 'kuppi_request', 'comment', 'listing'));

-- ---------------------------------------------------------------------------------------------
-- Helpers (private)
-- ---------------------------------------------------------------------------------------------

-- A rep of the batch: an admin of its batch group.
create or replace function shop.is_rep(p_cohort_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_cohort_id is not null and exists (
    select 1 from messaging.conversations c
    join messaging.conversation_members m on m.conversation_id = c.id
    where c.cohort_id = p_cohort_id and c.kind = 'cohort' and m.user_id = (select auth.uid()) and m.role = 'admin');
$$;

-- The seller, and for merch every rep of its batch.
create or replace function shop.can_manage(p shop.listings)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (p.seller_id = (select auth.uid()) or (p.kind = 'merch' and shop.is_rep(p.cohort_id)));
$$;

-- Who sees a listing: those who manage it, students with an order on it, and otherwise students at
-- its university (its batch, for batch-only merch) while it is up, unless one blocked the other.
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
        and p.institution_id = (select identity.current_institution_id())
        and (p.audience = 'university'
             or exists (select 1 from academics.cohort_members m where m.cohort_id = p.cohort_id and m.user_id = (select auth.uid())))
        and (p.expires_at is null or p.expires_at > now())
        and not exists (select 1 from safety.blocks b
                        where (b.blocker_id = p.seller_id and b.blocked_id = (select auth.uid()))
                           or (b.blocker_id = (select auth.uid()) and b.blocked_id = p.seller_id))));
$$;

-- The listing, if the caller may see it; otherwise the same error whether or not it exists.
create or replace function shop.visible_listing(p_id uuid)
returns shop.listings
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v shop.listings;
begin
  select * into v from shop.listings l where l.id = p_id;
  if v.id is null or not shop.can_see(v) then
    raise exception 'This listing is not available.' using errcode = '42501';
  end if;
  return v;
end;
$$;

-- "077 123 4567" -> "0771234567"; "+94 77 123 4567" -> "+94771234567". Null when not a phone number.
create or replace function shop.clean_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when x ~ '^\+?[0-9]{9,15}$' then x end
  from (select regexp_replace(coalesce(p_phone, ''), '[\s().-]', '', 'g') as x) s;
$$;

create or replace function shop.ordering_open(p shop.listings)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p.kind = 'merch' and p.status = 'open' and p.closes_at > now();
$$;

create or replace function shop.order_json(o shop.orders, p_for_rep boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id,
    'lines', o.lines,
    'quantity', o.quantity,
    'total', o.total,
    'phone', o.phone,
    'note', o.note,
    'slip_path', o.slip_path,
    'status', o.status,
    'status_note', o.status_note,
    'checked_by', (select p.full_name from identity.profiles p where p.user_id = o.status_by),
    'created_at', o.created_at,
    'updated_at', o.updated_at)
  || case when p_for_rep then jsonb_build_object('buyer', (
       select jsonb_build_object(
         'id', p.user_id,
         'name', p.full_name,
         'avatar_path', p.avatar_path,
         'email', u.email,
         'batch', (select academics.batch_name(m.cohort_id) from academics.cohort_members m where m.user_id = p.user_id limit 1))
       from identity.profiles p join auth.users u on u.id = p.user_id
       where p.user_id = o.buyer_id))
     else '{}'::jsonb end;
$$;

-- A listing for the caller. p_full: everything the listing screen needs; otherwise a feed card.
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
       'my_phone', (select o.phone from shop.orders o where o.buyer_id = (select auth.uid()) order by o.created_at desc limit 1))
     else '{}'::jsonb end;
$$;

-- Checks that every path is an upload of this kind the caller may use here: their own and unused,
-- or already on this listing.
create or replace function shop.check_listing_uploads(p_listing_id uuid, p_kind text, p_paths text[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if cardinality(p_paths) <> (select count(distinct x) from unnest(p_paths) x)
     or cardinality(p_paths) <> (
       select count(*) from shop.uploads u
       where u.path = any (p_paths) and u.kind = p_kind and u.order_id is null
         and ((p_listing_id is not null and u.listing_id = p_listing_id)
              or (u.user_id = v_uid and u.listing_id is null))) then
    raise exception 'A photo did not finish uploading. Add it again.' using errcode = '22023';
  end if;
end;
$$;

-- Attaches the uploads to the listing and lets go of the ones it no longer uses.
create or replace function shop.link_listing_uploads(p_listing_id uuid, p_kind text, p_paths text[])
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update shop.uploads u set listing_id = null
  where u.listing_id = p_listing_id and u.kind = p_kind and not (u.path = any (p_paths));
  update shop.uploads u set listing_id = p_listing_id
  where u.path = any (p_paths) and u.kind = p_kind;
$$;

-- ---------------------------------------------------------------------------------------------
-- Browsing
-- ---------------------------------------------------------------------------------------------

-- The shop tab: what is on sale at the caller's university (and their batch's merch), newest first.
-- p_filter: 'all', 'merch' or 'item'. p_before: the created_at of the last card, for the next page.
create or replace function api.shop_feed(
  p_filter text default 'all',
  p_category text default null,
  p_query text default null,
  p_before timestamptz default null,
  p_limit integer default 30
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
  if coalesce(p_filter, 'all') not in ('all', 'merch', 'item') then
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
        where x.institution_id = v_institution and x.status = 'open'
          and (x.audience = 'university' or x.cohort_id = v_cohort)
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

create or replace function api.shop_listing(p_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return shop.listing_json(shop.visible_listing(p_listing_id), true);
end;
$$;

-- What the caller sells, and the merch their batch's reps run, newest first.
create or replace function api.my_listings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cohort bigint;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select c.id into v_cohort from academics.my_cohort() c;
  return coalesce((
    select jsonb_agg(shop.listing_json(l, false) || jsonb_build_object(
             'orders', (select count(*) from shop.orders o where o.listing_id = l.id and o.status <> 'cancelled'),
             'to_check', (select count(*) from shop.orders o where o.listing_id = l.id and o.status = 'placed'))
           order by l.created_at desc)
    from shop.listings l
    where l.status <> 'removed'
      and (l.seller_id = v_uid or (l.kind = 'merch' and l.cohort_id = v_cohort and shop.is_rep(v_cohort)))), '[]'::jsonb);
end;
$$;

-- The caller's orders, newest first.
create or replace function api.my_orders()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(shop.order_json(o, false) || jsonb_build_object('listing', jsonb_build_object(
             'id', l.id, 'title', l.title, 'photo', l.photos[1], 'status', l.status, 'closes_at', l.closes_at,
             'collect_details', l.collect_details, 'batch', academics.batch_name(l.cohort_id)))
           order by o.created_at desc)
    from (select * from shop.orders o where o.buyer_id = v_uid and o.status <> 'cancelled'
          order by o.created_at desc limit 100) o
    join shop.listings l on l.id = o.listing_id), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Selling
-- ---------------------------------------------------------------------------------------------

-- Reserves a path for one photo, size chart or payment slip (JPEG, made on the phone). The media
-- function signs an upload URL for exactly this path and size.
create or replace function api.begin_shop_upload(p_kind text, p_size integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_path text;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('photo', 'chart', 'slip') then
    raise exception 'Unknown upload.' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or p_size > 3000000 then
    raise exception 'Photos can be up to 3 MB.' using errcode = '22023';
  end if;
  perform messaging.hit_limit('shop_upload', 80, 'You have uploaded a lot of photos today. Try again tomorrow.');
  v_path := 'shop/' || v_uid || '/' || ops.uuid_v7() || '.jpg';
  insert into shop.uploads (path, user_id, kind, size) values (v_path, v_uid, p_kind, p_size);
  return jsonb_build_object('path', v_path);
end;
$$;

-- Creates (no p_listing_id) or edits a listing. p_listing:
--   kind            'merch' (batch reps) or 'item' (any student); fixed once created
--   title, description, price (rupees), photos (1 to 6 upload paths)
--   merch: sizes (up to 12, e.g. ["S","M","L"]), size_chart (upload path), closes_at,
--          audience ('batch' or 'university'), payment_details, collect_details, needs_slip
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
    if v_audience not in ('batch', 'university') then
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
    v_audience := 'university';
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

  if v_kind = 'merch' then
    insert into ops.audit_log (actor_id, action, target_table, target_id, details)
    values (v_uid, case when v_old.id is null then 'shop.merch_created' else 'shop.merch_changed' end, 'shop.listings', v_row.id::text,
            jsonb_build_object('title', v_title, 'price', v_price, 'sizes', v_sizes, 'closes_at', v_closes,
                               'payment_details', v_payment, 'cohort_id', v_cohort));
  end if;
  return shop.listing_json(v_row, true);
end;
$$;

-- p_status: merch 'open' (take orders again), 'closed' (stop orders) or 'removed' (only before
-- anyone ordered); item 'open', 'sold', 'removed' or 'renew' (30 more days).
create or replace function api.set_listing_status(p_listing_id uuid, p_status text)
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
  select * into v from shop.listings l where l.id = p_listing_id for update;
  if v.id is null or not shop.can_manage(v) then
    raise exception 'This listing is not available.' using errcode = '42501';
  end if;
  if v.status = 'hidden' then
    raise exception 'Our team is reviewing this listing after reports.' using errcode = '22023';
  end if;
  if v.status = 'removed' then
    raise exception 'This listing was removed.' using errcode = '22023';
  end if;
  if v.kind = 'merch' then
    if p_status not in ('open', 'closed', 'removed') then
      raise exception 'Unknown change.' using errcode = '22023';
    end if;
    if p_status = 'open' and v.closes_at <= now() then
      raise exception 'The closing date has passed. Edit the listing to set a new one.' using errcode = '22023';
    end if;
    if p_status = 'removed' and exists (select 1 from shop.orders o where o.listing_id = v.id and o.status <> 'cancelled') then
      raise exception 'People have ordered. Close orders instead.' using errcode = '22023';
    end if;
    update shop.listings l set status = p_status where l.id = v.id returning * into v;
    insert into ops.audit_log (actor_id, action, target_table, target_id, details)
    values (v_uid, 'shop.merch_status', 'shop.listings', v.id::text, jsonb_build_object('status', p_status));
  else
    if p_status not in ('open', 'sold', 'removed', 'renew') then
      raise exception 'Unknown change.' using errcode = '22023';
    end if;
    update shop.listings l set
      status = case when p_status = 'renew' then 'open' else p_status end,
      expires_at = case when p_status in ('renew', 'open') then now() + interval '30 days' else l.expires_at end
    where l.id = v.id returning * into v;
  end if;
  return shop.listing_json(v, true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Ordering
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
  return shop.listing_json(v, true);
end;
$$;

create or replace function api.cancel_order(p_order_id uuid)
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
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v_order from shop.orders o where o.id = p_order_id and o.buyer_id = v_uid for update;
  if v_order.id is null or v_order.status = 'cancelled' then
    raise exception 'This order is not available.' using errcode = '42501';
  end if;
  if v_order.status in ('paid', 'collected') then
    raise exception 'A rep has confirmed your order. Message them to cancel it.' using errcode = '22023';
  end if;
  update shop.orders o set status = 'cancelled' where o.id = v_order.id;
  select * into v from shop.listings l where l.id = v_order.listing_id;
  return shop.listing_json(v, true);
end;
$$;

-- Every order for a listing, for the reps who manage it: the buyer's name, batch, email and phone,
-- what they ordered and their slip, plus totals per size.
create or replace function api.listing_orders(p_listing_id uuid)
returns jsonb
language plpgsql
stable
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
  select * into v from shop.listings l where l.id = p_listing_id;
  if v.id is null or not shop.can_manage(v) then
    raise exception 'Only the reps who run this can see its orders.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'listing', shop.listing_json(v, false),
    'orders', coalesce((select jsonb_agg(shop.order_json(o, true) order by o.created_at)
                        from shop.orders o where o.listing_id = v.id and o.status <> 'cancelled'), '[]'::jsonb),
    'sizes', coalesce((
      select jsonb_agg(jsonb_build_object('size', z.size, 'quantity', z.quantity, 'paid', z.paid)
                       order by array_position(v.sizes, z.size))
      from (select l ->> 'size' as size, sum((l ->> 'quantity')::integer) as quantity,
                   sum((l ->> 'quantity')::integer) filter (where o.status in ('paid', 'collected')) as paid
            from shop.orders o, jsonb_array_elements(o.lines) l
            where o.listing_id = v.id and o.status <> 'cancelled' group by 1) z), '[]'::jsonb),
    'totals', (select jsonb_build_object(
                 'orders', count(*),
                 'quantity', coalesce(sum(o.quantity), 0),
                 'to_check', count(*) filter (where o.status = 'placed'),
                 'paid', coalesce(sum(o.total) filter (where o.status in ('paid', 'collected')), 0),
                 'expected', coalesce(sum(o.total) filter (where o.status <> 'rejected'), 0))
               from shop.orders o where o.listing_id = v.id and o.status <> 'cancelled'));
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
  return api.listing_orders(v.id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------------------------

-- Reports go to the moderators of the listing's university. Three students reporting hides it until
-- a moderator looks.
create or replace function api.report_listing(p_listing_id uuid, p_category text, p_details text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v shop.listings;
  v_id uuid;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v := shop.visible_listing(p_listing_id);
  if v.seller_id = v_uid then
    raise exception 'You listed this. Remove it instead.' using errcode = '22023';
  end if;
  if not exists (select 1 from safety.report_categories rc where rc.code = p_category) then
    raise exception 'Choose what is wrong.' using errcode = '22023';
  end if;
  if p_details is not null and char_length(p_details) > 1000 then
    raise exception 'Keep the details under 1,000 characters.' using errcode = '22023';
  end if;
  select r.id into v_id from safety.reports r
  where r.reporter_id = v_uid and r.target_kind = 'listing' and r.target_id = p_listing_id::text and r.status = 'open';
  if v_id is not null then
    return v_id;
  end if;
  perform messaging.hit_limit('report', 20, 'You have sent a lot of reports today. Our team will look at them first.');
  insert into safety.reports (reporter_id, institution_id, target_kind, target_id, category_code, details, snapshot)
  values (v_uid, v.institution_id, 'listing', p_listing_id::text, p_category,
          nullif(btrim(coalesce(p_details, '')), ''),
          shop.listing_json(v, true) || jsonb_build_object('seller_id', v.seller_id))
  returning id into v_id;
  if v.status in ('open', 'closed', 'sold')
     and (select count(distinct r.reporter_id) from safety.reports r
          where r.target_kind = 'listing' and r.target_id = p_listing_id::text and r.status = 'open') >= 3 then
    update shop.listings l set status = 'hidden' where l.id = v.id;
    insert into ops.audit_log (actor_id, action, target_table, target_id, details)
    values (null, 'shop.hidden_after_reports', 'shop.listings', v.id::text, jsonb_build_object('was', v.status));
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Photos and slips: who may read them (adds shop uploads to api.media_access)
-- ---------------------------------------------------------------------------------------------

create or replace function api.media_access(p_paths text[])
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select r.path from messaging.media_refs r
  join messaging.conversation_members m on m.conversation_id = r.conversation_id and m.user_id = (select auth.uid())
  where r.path = any (p_paths[1:100]) and (select identity.is_active_user())
    and not exists (select 1 from content.chat_items b where b.path = r.path and b.check_status = 'blocked')
  union
  select i.path from content.chat_items i
  join content.library_items li on li.message_id = i.message_id and li.user_id = (select auth.uid())
  where i.path = any (p_paths[1:100]) and li.saved and not li.hidden and i.deleted_at is null
    and i.check_status <> 'blocked' and (select identity.is_active_user())
  union
  select r.storage_key from content.resources r
  where r.storage_key = any (p_paths[1:100]) and r.deleted_at is null and (select identity.is_active_user())
    and ((r.status = 'live' and (r.institution_id = (select identity.current_institution_id()) or r.scope = 'national'))
         or (r.uploader_id = (select auth.uid()) and r.status in ('pending', 'quarantined', 'duplicate')))
  union
  -- Shop: the uploader; a listing's photos and size chart for whoever can see the listing; a slip
  -- for its buyer and the reps who manage the listing.
  select u.path from shop.uploads u
  left join shop.listings l on l.id = u.listing_id
  left join shop.orders o on o.id = u.order_id
  left join shop.listings ol on ol.id = o.listing_id
  where u.path = any (p_paths[1:100]) and (select identity.is_active_user())
    and (u.user_id = (select auth.uid())
         or (l.id is not null and shop.can_see(l))
         or (o.id is not null and o.status <> 'cancelled' and (o.buyer_id = (select auth.uid()) or shop.can_manage(ol))));
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: private helpers for nobody; the api functions for signed-in students only.
-- ---------------------------------------------------------------------------------------------

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig, n.nspname as schema from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'shop' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end;
$$;

revoke execute on function api.shop_feed(text, text, text, timestamptz, integer) from public, anon;
revoke execute on function api.shop_listing(uuid) from public, anon;
revoke execute on function api.my_listings() from public, anon;
revoke execute on function api.my_orders() from public, anon;
revoke execute on function api.begin_shop_upload(text, integer) from public, anon;
revoke execute on function api.save_listing(jsonb, uuid) from public, anon;
revoke execute on function api.set_listing_status(uuid, text) from public, anon;
revoke execute on function api.place_order(uuid, jsonb, text, text, text) from public, anon;
revoke execute on function api.cancel_order(uuid) from public, anon;
revoke execute on function api.listing_orders(uuid) from public, anon;
revoke execute on function api.set_order_status(uuid, text, text) from public, anon;
revoke execute on function api.report_listing(uuid, text, text) from public, anon;

grant execute on function api.shop_feed(text, text, text, timestamptz, integer) to authenticated;
grant execute on function api.shop_listing(uuid) to authenticated;
grant execute on function api.my_listings() to authenticated;
grant execute on function api.my_orders() to authenticated;
grant execute on function api.begin_shop_upload(text, integer) to authenticated;
grant execute on function api.save_listing(jsonb, uuid) to authenticated;
grant execute on function api.set_listing_status(uuid, text) to authenticated;
grant execute on function api.place_order(uuid, jsonb, text, text, text) to authenticated;
grant execute on function api.cancel_order(uuid) to authenticated;
grant execute on function api.listing_orders(uuid) to authenticated;
grant execute on function api.set_order_status(uuid, text, text) to authenticated;
grant execute on function api.report_listing(uuid, text, text) to authenticated;
