-- Shop, part 3: merch leads for clubs and societies, and everyone hears about new listings.
--
-- Merch leads: a batch rep (or a moderator) makes a student at their university a merch lead for a
-- club or society ("Rotaract Club"). Merch leads publish merch for that club, open to the university
-- or to every university, shown as "from Rotaract Club". Every merch lead of the same club at the
-- university manages its orders together, as a batch's reps do. The rep who appointed a lead, a
-- moderator or the lead themself can end it; every change is audited.
--
-- New listings: anything open to the university or to every university is announced to everyone who
-- can see it (a batch's own merch still goes to the batch as before), at most one "new in the shop"
-- push every 30 minutes per student. Quiet hours, blocks and the phone's Shop channel apply.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table shop.merch_leads (
  user_id uuid primary key references identity.profiles (user_id) on delete cascade,
  institution_id bigint not null references identity.institutions (id) on delete cascade,
  club text not null check (char_length(btrim(club)) between 2 and 60),
  appointed_by uuid references identity.profiles (user_id) on delete set null,
  created_at timestamptz not null default now()
);
create index merch_leads_club_idx on shop.merch_leads (institution_id, lower(club));
create index merch_leads_appointed_by_idx on shop.merch_leads (appointed_by);
alter table shop.merch_leads enable row level security;
-- No grants or policies: through the functions below.

-- Merch is from a batch (cohort_id) or from a club or society (club).
alter table shop.listings add column club text check (char_length(club) <= 60);
alter table shop.listings add constraint listings_merch_from check (kind = 'item' or cohort_id is not null or club is not null);
create index listings_club_idx on shop.listings (institution_id, lower(club)) where club is not null;

alter table shop.pushes drop constraint pushes_kind_check;
alter table shop.pushes add constraint pushes_kind_check check (kind in ('order', 'order_status', 'merch', 'interest', 'listing'));
create index pushes_kind_recent_idx on shop.pushes (user_id, kind, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- The club or society the caller is a merch lead for, at their university.
create or replace function shop.my_club()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select l.club from shop.merch_leads l
  where l.user_id = (select auth.uid()) and l.institution_id = (select identity.current_institution_id());
$$;

-- The seller; for a batch's merch its reps; for a club's merch its merch leads.
create or replace function shop.can_manage(p shop.listings)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (p.seller_id = (select auth.uid())
         or (p.kind = 'merch' and shop.is_rep(p.cohort_id))
         or (p.kind = 'merch' and p.club is not null and exists (
               select 1 from shop.merch_leads l
               where l.user_id = (select auth.uid()) and l.institution_id = p.institution_id and lower(l.club) = lower(p.club))));
$$;

-- Everyone a new listing is announced to: active students with a phone registered who can see it
-- (its university, or every university), except the seller, anyone blocked either way, and a batch's
-- own members for its merch (they hear "New merch from your reps" instead).
create or replace function shop.audience_of(p shop.listings)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    select pr.user_id from identity.profiles pr
    where pr.account_status = 'active'
      and (p.audience = 'everyone' or (p.audience = 'university' and pr.institution_id = p.institution_id))
      and pr.user_id <> p.seller_id
      and exists (select 1 from messaging.push_tokens t where t.user_id = pr.user_id)
      and (p.cohort_id is null
           or not exists (select 1 from academics.cohort_members m where m.cohort_id = p.cohort_id and m.user_id = pr.user_id))
      and not exists (select 1 from safety.blocks b
                      where (b.blocker_id = p.seller_id and b.blocked_id = pr.user_id)
                         or (b.blocker_id = pr.user_id and b.blocked_id = p.seller_id)));
$$;

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
          where s.user_id = x.u and s.listing_id = p_listing_id and s.kind = p_kind and s.created_at > now() - interval '10 minutes'))
    -- New in the shop: at most one every 30 minutes per student, whatever was listed.
    and (p_kind <> 'listing' or not exists (
          select 1 from shop.pushes s where s.user_id = x.u and s.kind = 'listing' and s.created_at > now() - interval '30 minutes'));
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
    where p.kind = 'merch' and c.cohort_id = p.cohort_id and c.kind = 'cohort' and m.role = 'admin'
    union
    select l.user_id from shop.merch_leads l
    where p.kind = 'merch' and p.club is not null and l.institution_id = p.institution_id and lower(l.club) = lower(p.club));
$$;

-- ---------------------------------------------------------------------------------------------
-- Listings for the caller (adds the club)
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
    -- Merch from a club or society (published by its merch leads).
    'club', p.club,
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
-- The shop tab: who may publish merch, and for what
-- ---------------------------------------------------------------------------------------------

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
    'can_post_merch', shop.is_rep(v_cohort) or shop.my_club() is not null,
    'is_rep', shop.is_rep(v_cohort),
    -- The club or society the caller publishes merch for, as a merch lead.
    'merch_club', shop.my_club(),
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

-- What the caller sells, the merch their batch's reps run and their club's merch, newest first.
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
      and (l.seller_id = v_uid
           or (l.kind = 'merch' and l.cohort_id = v_cohort and shop.is_rep(v_cohort))
           or (l.kind = 'merch' and l.club is not null and l.institution_id = (select identity.current_institution_id())
               and shop.can_manage(l)))), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Selling: club merch, and new listings announced
-- ---------------------------------------------------------------------------------------------

-- Creates (no p_listing_id) or edits a listing. p_listing:
--   kind            'merch' (batch reps and merch leads) or 'item' (any student); fixed once created
--   as              merch only, when created: 'batch' (a rep, for their batch) or 'club' (a merch
--                   lead, for their club or society); defaults to 'batch' for reps
--   title, description, price (rupees), photos (1 to 6 upload paths)
--   audience        batch merch: 'batch', 'university' or 'everyone'; club merch and items:
--                   'university' or 'everyone'
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
  v_club text;
  v_as text;
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
    -- New merch is for the rep's batch ('batch') or for the merch lead's club or society ('club').
    if v_old.id is null then
      select c.id into v_cohort from academics.my_cohort() c;
      v_as := coalesce(p_listing ->> 'as', case when shop.is_rep(v_cohort) then 'batch' else 'club' end);
      if v_as = 'batch' then
        if not shop.is_rep(v_cohort) then
          raise exception 'Batch reps publish merch for their batch.' using errcode = '42501';
        end if;
      elsif v_as = 'club' then
        v_club := shop.my_club();
        v_cohort := null;
        if v_club is null then
          raise exception 'Ask a batch rep to make you a merch lead for your club or society.' using errcode = '42501';
        end if;
      else
        raise exception 'Choose who the merch is from.' using errcode = '22023';
      end if;
    else
      v_cohort := v_old.cohort_id;
      v_club := v_old.club;
    end if;
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
    if v_audience not in ('batch', 'university', 'everyone') or (v_audience = 'batch' and v_cohort is null) then
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
    insert into shop.listings (kind, seller_id, institution_id, cohort_id, club, audience, title, description, price, category,
                               condition, photos, size_chart, sizes, closes_at, payment_details, collect_details, needs_slip,
                               contact_phone, expires_at)
    values (v_kind, v_uid, (select identity.current_institution_id()), case when v_kind = 'merch' then v_cohort end,
            case when v_kind = 'merch' then v_club end, v_audience,
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

  -- Something new: a batch's merch tells the batch; anything open to the university or to every
  -- university tells everyone else who can see it (at most one such push every 30 minutes each).
  -- Students can turn Shop notifications off on their phone.
  if v_old.id is null then
    if v_kind = 'merch' and v_cohort is not null then
      perform shop.notify(
        array(select m.user_id from academics.cohort_members m where m.cohort_id = v_cohort),
        v_row.id, 'merch', 'New merch from your reps',
        v_title || ' · Rs ' || to_char(v_price, 'FM9,999,999') || '. Order by '
          || to_char(v_closes at time zone 'Asia/Colombo', 'Dy DD Mon') || '.');
    end if;
    if v_audience in ('university', 'everyone') then
      perform shop.notify(
        shop.audience_of(v_row), v_row.id, 'listing',
        case when v_kind = 'item' then 'New in the shop'
             when v_club is not null then 'New merch from ' || v_club
             else 'New merch' end,
        v_title || ' · ' || case when v_price = 0 then 'Free' else 'Rs ' || to_char(v_price, 'FM9,999,999') end
          || case when v_kind = 'merch'
               then '. Order by ' || to_char(v_closes at time zone 'Asia/Colombo', 'Dy DD Mon') || '.'
               else ' · ' || split_part((select p.full_name from identity.profiles p where p.user_id = v_uid), ' ', 1)
                 || coalesce(' (' || (select i.short_name from identity.institutions i where i.id = v_row.institution_id) || ')', '')
             end);
    end if;
  end if;

  if v_kind = 'merch' then
    insert into ops.audit_log (actor_id, action, target_table, target_id, details)
    values (v_uid, case when v_old.id is null then 'shop.merch_created' else 'shop.merch_changed' end, 'shop.listings', v_row.id::text,
            jsonb_build_object('title', v_title, 'price', v_price, 'sizes', v_sizes, 'closes_at', v_closes,
                               'payment_details', v_payment, 'cohort_id', v_cohort, 'club', v_club));
  end if;
  return shop.listing_json(v_row, true);
end;
$$;


-- ---------------------------------------------------------------------------------------------
-- Merch leads
-- ---------------------------------------------------------------------------------------------

create or replace function shop.lead_json(l shop.merch_leads)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user', (select jsonb_build_object('id', p.user_id, 'name', p.full_name, 'avatar_path', p.avatar_path,
                                       'batch', (select academics.batch_name(m.cohort_id) from academics.cohort_members m
                                                 where m.user_id = p.user_id limit 1))
             from identity.profiles p where p.user_id = l.user_id),
    'club', l.club,
    'appointed_by', (select p.full_name from identity.profiles p where p.user_id = l.appointed_by),
    'mine', l.appointed_by = (select auth.uid()),
    'created_at', l.created_at);
$$;

-- For reps and moderators: the merch leads at their university, clubs in order. For everyone: whether
-- they are one themself.
create or replace function api.merch_leads()
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
  v_can boolean;
begin
  if v_uid is null or v_institution is null then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select c.id into v_cohort from academics.my_cohort() c;
  v_can := shop.is_rep(v_cohort) or identity.is_staff_for(v_institution);
  return jsonb_build_object(
    'can_appoint', v_can,
    'me', (select shop.lead_json(l) from shop.merch_leads l where l.user_id = v_uid and l.institution_id = v_institution),
    'leads', case when v_can then coalesce((
      select jsonb_agg(shop.lead_json(l) order by lower(l.club), l.created_at)
      from shop.merch_leads l where l.institution_id = v_institution), '[]'::jsonb) else '[]'::jsonb end);
end;
$$;

-- Makes a student at the caller's university a merch lead for a club or society (or moves them to
-- another). Batch reps and moderators; up to 20 leads per rep.
create or replace function api.appoint_merch_lead(p_user_id uuid, p_club text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint := (select identity.current_institution_id());
  v_cohort bigint;
  v_club text := btrim(regexp_replace(coalesce(p_club, ''), '\s+', ' ', 'g'));
begin
  if v_uid is null or v_institution is null then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select c.id into v_cohort from academics.my_cohort() c;
  if not (shop.is_rep(v_cohort) or identity.is_staff_for(v_institution)) then
    raise exception 'Batch reps choose merch leads.' using errcode = '42501';
  end if;
  if char_length(v_club) < 2 or char_length(v_club) > 60 then
    raise exception 'Enter the club or society name (2 to 60 characters).' using errcode = '22023';
  end if;
  if not exists (select 1 from identity.profiles p
                 where p.user_id = p_user_id and p.account_status = 'active' and p.institution_id = v_institution) then
    raise exception 'Choose a student at your university.' using errcode = '22023';
  end if;
  if (select count(*) from shop.merch_leads l where l.appointed_by = v_uid and l.user_id <> p_user_id) >= 20 then
    raise exception 'You have 20 merch leads. End one first.' using errcode = '22023';
  end if;
  perform messaging.hit_limit('merch_lead', 30, 'You have changed a lot of merch leads today. Try again tomorrow.');
  insert into shop.merch_leads as l (user_id, institution_id, club, appointed_by)
  values (p_user_id, v_institution, v_club, v_uid)
  on conflict (user_id) do update set institution_id = excluded.institution_id, club = excluded.club,
    appointed_by = excluded.appointed_by, created_at = now();
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_uid, 'shop.lead_appointed', 'shop.merch_leads', p_user_id::text, jsonb_build_object('club', v_club));
  return api.merch_leads();
end;
$$;

-- Ends a merch lead: the rep who appointed them, a moderator, or the lead themself.
create or replace function api.remove_merch_lead(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_lead shop.merch_leads;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v_lead from shop.merch_leads l where l.user_id = p_user_id for update;
  if v_lead.user_id is null
     or not (v_lead.user_id = v_uid or v_lead.appointed_by = v_uid or identity.is_staff_for(v_lead.institution_id)) then
    raise exception 'Only the rep who chose this merch lead can end it.' using errcode = '42501';
  end if;
  delete from shop.merch_leads l where l.user_id = p_user_id;
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_uid, 'shop.lead_removed', 'shop.merch_leads', p_user_id::text, jsonb_build_object('club', v_lead.club));
  return api.merch_leads();
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------

revoke execute on function shop.my_club() from public, anon, authenticated;
revoke execute on function shop.can_manage(shop.listings) from public, anon, authenticated;
revoke execute on function shop.audience_of(shop.listings) from public, anon, authenticated;
revoke execute on function shop.notify(uuid[], uuid, text, text, text) from public, anon, authenticated;
revoke execute on function shop.managers(shop.listings) from public, anon, authenticated;
revoke execute on function shop.listing_json(shop.listings, boolean) from public, anon, authenticated;
revoke execute on function shop.lead_json(shop.merch_leads) from public, anon, authenticated;

revoke execute on function api.merch_leads() from public, anon;
revoke execute on function api.appoint_merch_lead(uuid, text) from public, anon;
revoke execute on function api.remove_merch_lead(uuid) from public, anon;
grant execute on function api.merch_leads() to authenticated;
grant execute on function api.appoint_merch_lead(uuid, text) to authenticated;
grant execute on function api.remove_merch_lead(uuid) to authenticated;
