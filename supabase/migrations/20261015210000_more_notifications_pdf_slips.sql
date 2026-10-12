-- More notifications, and PDF payment slips.
--
-- A review of what the app notified about found these missing; each now sends a push (they cost
-- nothing, and each is something a student acts on):
--   kuppi      a new kuppi in a module you take (not to those already told it answers their
--              request); a kuppi you are going to is cancelled (with the reason); starting in 15
--              minutes, to the host and everyone going
--   exams      your batch's exam date is set or moved; the evening before an exam or deadline
--   shop       a buyer cancels an order (to the reps); your listing is hidden after reports; you
--              are made a merch lead; orders for your batch's merch close tomorrow (to batchmates
--              who have not ordered); your listing leaves the shop in two days
--   files      your shared file is live, or was not published and why; a comment on your file;
--              a reply to your comment
--   account    approved, not approved, or active again (students waiting for approval can now
--              register their phone for this)
-- Each goes through messaging.notify with a channel (Android: Kuppi, Exams and deadlines, Shop,
-- Your shared files, Account, each can be turned off on its own) and an in-app link (href) the app
-- opens when it is tapped. Quiet hours apply. Reminders run from pg_cron.
--
-- PDF slips: a payment slip can be a PDF (the bank app's receipt), up to 5 MB. It is checked like a
-- chat document (no scripts, launch actions or embedded files) before an order can use it.

-- ---------------------------------------------------------------------------------------------
-- App notifications: more kinds and channels, links, and "already told" keys
-- ---------------------------------------------------------------------------------------------

alter table messaging.app_pushes drop constraint app_pushes_kind_check;
alter table messaging.app_pushes add constraint app_pushes_kind_check check (kind in (
  'kuppi_answered', 'kuppi_new', 'kuppi_cancelled', 'kuppi_starting',
  'exam_set', 'exam_tomorrow',
  'order_cancelled', 'listing_hidden', 'merch_lead', 'merch_closing', 'listing_expiring',
  'file_checked', 'file_comment', 'comment_reply',
  'account'));
alter table messaging.app_pushes drop constraint app_pushes_channel_check;
alter table messaging.app_pushes add constraint app_pushes_channel_check
  check (channel in ('kuppi', 'exams', 'shop', 'files', 'account'));
-- What the notification is about ("kuppi:<id>"): someone already told about it is not told twice,
-- and a busy thread (comments) buzzes at most once in a while.
alter table messaging.app_pushes add column key text check (char_length(key) <= 100);
create index app_pushes_key_idx on messaging.app_pushes (user_id, key, created_at desc) where key is not null;

drop function messaging.notify(uuid[], text, text, text, jsonb, text);

-- Queues one notification to each student (never the one acting), skipping those with no phone
-- registered, inactive accounts (unless p_any_status: account news) and quiet hours. With p_key,
-- students told about the same key within p_quiet_for are skipped.
create or replace function messaging.notify(
  p_users uuid[],
  p_kind text,
  p_title text,
  p_body text,
  p_data jsonb,
  p_channel text,
  p_key text default null,
  p_quiet_for interval default null,
  p_any_status boolean default false
)
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
  insert into messaging.app_pushes (batch_id, user_id, kind, title, body, data, channel, key)
  select v_batch, x.u, p_kind, left(p_title, 80), left(coalesce(p_body, ''), 180), coalesce(p_data, '{}'::jsonb), p_channel, p_key
  from (select distinct unnest(p_users) as u) x
  where x.u is not null and x.u is distinct from (select auth.uid())
    and exists (select 1 from messaging.push_tokens t where t.user_id = x.u)
    and exists (select 1 from identity.profiles pr where pr.user_id = x.u
                and (p_any_status or pr.account_status = 'active'))
    and not messaging.in_quiet_hours(x.u)
    and (p_key is null or p_quiet_for is null or not exists (
          select 1 from messaging.app_pushes s
          where s.user_id = x.u and s.key = p_key and s.created_at > now() - p_quiet_for));
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
    body := jsonb_build_object('app_batch', v_batch),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 10000
  );
end;
$$;

-- "Fri 24 Oct, 9:00 am" in Sri Lankan time.
create or replace function messaging.when_text(p_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_at at time zone 'Asia/Colombo', 'Dy DD Mon, FMHH12:MI am');
$$;

-- Students taking a module: members of its course chats (every intake), optionally only a batch's.
create or replace function messaging.module_students(p_module_id bigint, p_cohort_id bigint default null)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    select distinct m.user_id
    from messaging.conversations c
    join messaging.conversation_members m on m.conversation_id = c.id
    where c.kind = 'module' and c.module_id = p_module_id
      and (p_cohort_id is null
           or exists (select 1 from academics.cohort_members cm where cm.cohort_id = p_cohort_id and cm.user_id = m.user_id)));
$$;

-- ---------------------------------------------------------------------------------------------
-- Kuppi
-- ---------------------------------------------------------------------------------------------

alter table kuppi.sessions add column reminded_at timestamptz;
create index sessions_reminder_idx on kuppi.sessions (starts_at) where cancelled_at is null and reminded_at is null;

-- A kuppi answering a request: everyone who asked or voted (keyed, so they are not also told
-- "new kuppi").
create or replace function kuppi.request_answered()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session kuppi.sessions;
begin
  select * into v_session from kuppi.sessions s where s.id = new.session_id;
  if v_session.id is null then
    return null;
  end if;
  perform messaging.notify(
    array(select v.user_id from kuppi.request_votes v where v.request_id = new.id
          union select new.requester_id),
    'kuppi_answered',
    'Your kuppi request was answered',
    split_part(coalesce((select p.full_name from identity.profiles p where p.user_id = v_session.host_id), 'A student'), ' ', 1)
      || ' is hosting ' || v_session.title || ' on ' || messaging.when_text(v_session.starts_at) || '.',
    jsonb_build_object('kuppi_id', v_session.id, 'href', '/kuppi/' || v_session.id),
    'kuppi',
    'kuppi:' || v_session.id);
  return null;
end;
$$;

-- A new kuppi: the students taking the module at that university. Runs when the transaction
-- commits, after a request it answers has told its askers, who are then skipped.
create or replace function kuppi.session_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_module academics.modules;
begin
  select * into v_module from academics.modules m where m.id = new.module_id;
  perform messaging.notify(
    messaging.module_students(new.module_id),
    'kuppi_new',
    'New kuppi: ' || coalesce(v_module.code, 'your module'),
    split_part(coalesce((select p.full_name from identity.profiles p where p.user_id = new.host_id), 'A student'), ' ', 1)
      || ' is hosting ' || new.title || ' on ' || messaging.when_text(new.starts_at)
      || case when new.mode = 'online' then ', online.' else coalesce(' at ' || new.venue, '') || '.' end,
    jsonb_build_object('kuppi_id', new.id, 'href', '/kuppi/' || new.id),
    'kuppi',
    'kuppi:' || new.id,
    interval '30 days');
  return null;
end;
$$;
create constraint trigger sessions_created after insert on kuppi.sessions
  deferrable initially deferred
  for each row execute function kuppi.session_created();

-- A cancelled kuppi: everyone going.
create or replace function kuppi.session_cancelled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform messaging.notify(
    array(select r.user_id from kuppi.rsvps r where r.session_id = new.id),
    'kuppi_cancelled',
    'Kuppi cancelled: ' || new.title,
    messaging.when_text(new.starts_at) || coalesce('. ' || nullif(btrim(new.cancel_reason), ''), '. The host cancelled it.'),
    jsonb_build_object('kuppi_id', new.id, 'href', '/kuppi/' || new.id),
    'kuppi');
  return null;
end;
$$;
create trigger sessions_cancelled after update of cancelled_at on kuppi.sessions
  for each row when (old.cancelled_at is null and new.cancelled_at is not null)
  execute function kuppi.session_cancelled();

-- Every 5 minutes: kuppi starting in about 15 minutes (when the link opens) remind the host and
-- everyone going.
create or replace function kuppi.send_reminders()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v kuppi.sessions;
begin
  for v in
    update kuppi.sessions s set reminded_at = now()
    where s.cancelled_at is null and s.reminded_at is null
      and s.starts_at > now() and s.starts_at <= now() + interval '20 minutes'
    returning s.*
  loop
    perform messaging.notify(
      array(select r.user_id from kuppi.rsvps r where r.session_id = v.id union select v.host_id),
      'kuppi_starting',
      'Starting soon: ' || v.title,
      case when v.mode = 'online' then 'At ' || to_char(v.starts_at at time zone 'Asia/Colombo', 'FMHH12:MI am') || '. The join link is open now.'
           else 'At ' || to_char(v.starts_at at time zone 'Asia/Colombo', 'FMHH12:MI am') || coalesce(', ' || v.venue, '') || '.' end,
      jsonb_build_object('kuppi_id', v.id, 'href', '/kuppi/' || v.id),
      'kuppi');
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Exams
-- ---------------------------------------------------------------------------------------------

alter table academics.cohort_exams add column reminded_on date;

create or replace function academics.exam_label(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind when 'final' then 'final exam' when 'mid' then 'mid exam' when 'quiz' then 'quiz'
                     when 'practical' then 'practical' when 'deadline' then 'assignment deadline' else 'exam' end;
$$;

-- An exam set or moved: the batch's students taking the module (a rep moving it again within 10
-- minutes does not buzz them twice).
create or replace function academics.exam_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_module academics.modules;
begin
  if tg_op = 'UPDATE' and new.starts_at = old.starts_at and new.venue is not distinct from old.venue then
    return null;
  end if;
  select * into v_module from academics.modules m where m.id = new.module_id;
  perform messaging.notify(
    messaging.module_students(new.module_id, new.cohort_id),
    'exam_set',
    v_module.code || ' ' || academics.exam_label(new.kind) || case when tg_op = 'INSERT' then ' date set' else ' moved' end,
    case when new.kind = 'deadline' then 'Due ' else '' end || messaging.when_text(new.starts_at)
      || coalesce(', ' || new.venue, '') || '. ' || coalesce(v_module.name, ''),
    jsonb_build_object('href', '/exams'),
    'exams',
    'exam:' || new.id,
    interval '10 minutes');
  return null;
end;
$$;
create trigger cohort_exams_changed after insert or update of starts_at, venue on academics.cohort_exams
  for each row execute function academics.exam_changed();

-- Every evening (6 pm in Sri Lanka): tomorrow's exams and deadlines.
create or replace function academics.send_exam_reminders()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tomorrow date := (now() at time zone 'Asia/Colombo')::date + 1;
  v academics.cohort_exams;
  v_module academics.modules;
begin
  for v in
    update academics.cohort_exams e set reminded_on = v_tomorrow
    where (e.starts_at at time zone 'Asia/Colombo')::date = v_tomorrow and e.reminded_on is distinct from v_tomorrow
    returning e.*
  loop
    select * into v_module from academics.modules m where m.id = v.module_id;
    perform messaging.notify(
      messaging.module_students(v.module_id, v.cohort_id),
      'exam_tomorrow',
      case when v.kind = 'deadline' then 'Due tomorrow: ' else 'Tomorrow: ' end || v_module.code || ' ' || academics.exam_label(v.kind),
      'At ' || to_char(v.starts_at at time zone 'Asia/Colombo', 'FMHH12:MI am') || coalesce(', ' || v.venue, '') || '. '
        || coalesce(v_module.name, '') || '. Good luck!',
      jsonb_build_object('href', '/module/' || v.module_id),
      'exams');
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Shop
-- ---------------------------------------------------------------------------------------------

alter table shop.listings add column closing_reminded_at timestamptz;
alter table shop.listings add column expiry_reminded_at timestamptz;

-- A buyer cancels: the reps or merch leads running it.
create or replace function shop.order_cancelled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v shop.listings;
begin
  select * into v from shop.listings l where l.id = new.listing_id;
  perform messaging.notify(
    shop.managers(v),
    'order_cancelled',
    'Order cancelled: ' || v.title,
    split_part(coalesce((select p.full_name from identity.profiles p where p.user_id = new.buyer_id), 'A buyer'), ' ', 1)
      || ' cancelled their order (' || new.quantity || case when new.quantity = 1 then ' item' else ' items' end || ').'
      || case when new.slip_path is not null then ' If they paid, arrange the refund with them.' else '' end,
    jsonb_build_object('listing_id', v.id, 'href', '/shop/orders/' || v.id),
    'shop');
  return null;
end;
$$;
create trigger orders_cancelled after update of status on shop.orders
  for each row when (old.status <> 'cancelled' and new.status = 'cancelled')
  execute function shop.order_cancelled();

-- Hidden after reports: the seller hears why it left the shop.
create or replace function shop.listing_hidden()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform messaging.notify(
    array[new.seller_id],
    'listing_hidden',
    'Your listing is hidden for review',
    new.title || ' was reported by several students. Our team will look at it; until then it is not in the shop.',
    jsonb_build_object('listing_id', new.id, 'href', '/shop/' || new.id),
    'shop');
  return null;
end;
$$;
create trigger listings_hidden after update of status on shop.listings
  for each row when (old.status <> 'hidden' and new.status = 'hidden')
  execute function shop.listing_hidden();

-- Made a merch lead (or moved to another club): the student hears it.
create or replace function shop.lead_appointed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.club = old.club then
    return null;
  end if;
  perform messaging.notify(
    array[new.user_id],
    'merch_lead',
    'You are the merch lead of ' || new.club,
    split_part(coalesce((select p.full_name from identity.profiles p where p.user_id = new.appointed_by), 'A rep'), ' ', 1)
      || ' chose you. Publish merch for ' || new.club || ' from Sell in the Shop.',
    jsonb_build_object('href', '/shop/leads'),
    'shop');
  return null;
end;
$$;
create trigger merch_leads_appointed after insert or update of club on shop.merch_leads
  for each row execute function shop.lead_appointed();

-- Every hour: batch merch closing within a day reminds batchmates who have not ordered; student
-- listings leaving the shop within two days remind their sellers.
create or replace function shop.send_reminders()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v shop.listings;
begin
  for v in
    update shop.listings l set closing_reminded_at = now()
    where l.kind = 'merch' and l.status = 'open' and l.cohort_id is not null and l.closing_reminded_at is null
      and l.closes_at > now() + interval '2 hours' and l.closes_at <= now() + interval '24 hours'
    returning l.*
  loop
    perform messaging.notify(
      array(select m.user_id from academics.cohort_members m where m.cohort_id = v.cohort_id
            and not exists (select 1 from shop.orders o where o.listing_id = v.id and o.buyer_id = m.user_id and o.status <> 'cancelled')),
      'merch_closing',
      'Orders close tomorrow: ' || v.title,
      'Last day to pre-order: ' || messaging.when_text(v.closes_at) || '.',
      jsonb_build_object('listing_id', v.id, 'href', '/shop/' || v.id),
      'shop');
  end loop;
  for v in
    update shop.listings l set expiry_reminded_at = now()
    where l.kind = 'item' and l.status = 'open' and l.expiry_reminded_at is null
      and l.expires_at > now() and l.expires_at <= now() + interval '2 days'
    returning l.*
  loop
    perform messaging.notify(
      array[v.seller_id],
      'listing_expiring',
      'Still selling ' || v.title || '?',
      'It leaves the shop in two days. Open it and tap Keep it up for 30 more days.',
      jsonb_build_object('listing_id', v.id, 'href', '/shop/' || v.id),
      'shop');
  end loop;
end;
$$;

-- Renewing a listing lets it remind again next time.
create or replace function shop.listing_renewed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.expires_at is distinct from old.expires_at then
    new.expiry_reminded_at := null;
  end if;
  if new.closes_at is distinct from old.closes_at then
    new.closing_reminded_at := null;
  end if;
  return new;
end;
$$;
create trigger listings_renewed before update of expires_at, closes_at on shop.listings
  for each row execute function shop.listing_renewed();

-- ---------------------------------------------------------------------------------------------
-- Shared files
-- ---------------------------------------------------------------------------------------------

-- The check finished: the uploader hears whether it is live.
create or replace function content.resource_checked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.uploader_id is null then
    return null;
  end if;
  perform messaging.notify(
    array[new.uploader_id],
    'file_checked',
    case new.status when 'live' then 'Your file is live'
                    when 'duplicate' then 'Already shared'
                    else 'Your file was not published' end,
    new.title || case new.status
      when 'live' then ' is now in the shared library.'
      when 'duplicate' then ': someone at your university shared the same file, so theirs is used.'
      else coalesce(': ' || nullif(new.check_reason, ''), ': it did not pass the file check.') end,
    jsonb_build_object('href', '/resource/' || new.id),
    'files');
  return null;
end;
$$;
create trigger resources_checked after update of status on content.resources
  for each row when (old.status = 'pending' and new.status in ('live', 'quarantined', 'duplicate'))
  execute function content.resource_checked();

-- A comment: the file's uploader (at most once every 15 minutes per file); a reply: the comment's
-- author.
create or replace function content.comment_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resource content.resources;
  v_parent content.comments;
  v_name text := split_part(coalesce((select p.full_name from identity.profiles p where p.user_id = new.author_id), 'A student'), ' ', 1);
begin
  select * into v_resource from content.resources r where r.id = new.resource_id;
  if new.parent_id is not null then
    select * into v_parent from content.comments c where c.id = new.parent_id;
    if v_parent.author_id is not null and v_parent.author_id is distinct from new.author_id then
      perform messaging.notify(
        array[v_parent.author_id],
        'comment_reply',
        v_name || ' replied to you',
        left(new.body, 140),
        jsonb_build_object('href', '/resource/' || new.resource_id),
        'files',
        'reply:' || v_parent.id,
        interval '15 minutes');
    end if;
  end if;
  if v_resource.uploader_id is not null and v_resource.uploader_id is distinct from new.author_id
     and v_resource.uploader_id is distinct from v_parent.author_id then
    perform messaging.notify(
      array[v_resource.uploader_id],
      'file_comment',
      'New comment on ' || left(v_resource.title, 50),
      v_name || coalesce(' on ' || new.question, '') || ': ' || left(new.body, 120),
      jsonb_build_object('href', '/resource/' || new.resource_id),
      'files',
      'comments:' || new.resource_id,
      interval '15 minutes');
  end if;
  return null;
end;
$$;
create trigger comments_added after insert on content.comments
  for each row execute function content.comment_added();

-- ---------------------------------------------------------------------------------------------
-- Account
-- ---------------------------------------------------------------------------------------------

-- Approved, not approved, or active again: the student hears it (they may be waiting outside the app).
create or replace function identity.account_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.account_status = 'active' then
    perform messaging.notify(
      array[new.user_id], 'account',
      case when old.account_status = 'suspended' then 'Your account is active again' else 'You are in!' end,
      case when old.account_status = 'suspended' then 'You can use Uni Era again.'
           else 'The Uni Era team approved your account. Open the app to find your batch.' end,
      jsonb_build_object('href', '/'), 'account', null, null, true);
  elsif new.account_status = 'rejected' then
    perform messaging.notify(
      array[new.user_id], 'account',
      'We could not approve your account',
      'Open Uni Era to see why.',
      jsonb_build_object('href', '/'), 'account', null, null, true);
  end if;
  return null;
end;
$$;
create trigger profiles_account_changed after update of account_status on identity.profiles
  for each row when (old.account_status is distinct from new.account_status
                     and new.account_status in ('active', 'rejected'))
  execute function identity.account_changed();

-- Students waiting for approval can register their phone, so they hear when they are in.
create or replace function api.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not exists (select 1 from identity.profiles p
                                  where p.user_id = v_uid and p.account_status in ('active', 'pending')) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$' then
    raise exception 'That is not an Expo push token.' using errcode = '22023';
  end if;
  if p_platform is null or p_platform not in ('android', 'ios') then
    raise exception 'Choose android or ios.' using errcode = '22023';
  end if;

  insert into messaging.push_tokens as t (token, user_id, platform)
  values (p_token, v_uid, p_platform)
  on conflict (token) do update set user_id = v_uid, platform = p_platform, updated_at = now();

  delete from messaging.push_tokens t
  where t.user_id = v_uid
    and t.token not in (select x.token from messaging.push_tokens x where x.user_id = v_uid order by x.updated_at desc limit 10);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- PDF payment slips
-- ---------------------------------------------------------------------------------------------

alter table shop.uploads add column mime text not null default 'image/jpeg' check (mime in ('image/jpeg', 'application/pdf'));
-- PDFs wait for the media function's check before an order can use them; photos are made on the phone.
alter table shop.uploads add column checked boolean not null default true;

drop function api.begin_shop_upload(text, integer);

-- Reserves a path for one photo, size chart or payment slip. Photos are JPEGs made on the phone (up
-- to 3 MB); a slip may also be a PDF (up to 5 MB), checked after upload (api.shop_upload_checked).
create or replace function api.begin_shop_upload(p_kind text, p_size integer, p_mime text default 'image/jpeg')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pdf boolean := p_mime = 'application/pdf';
  v_path text;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('photo', 'chart', 'slip') then
    raise exception 'Unknown upload.' using errcode = '22023';
  end if;
  if p_mime is null or p_mime not in ('image/jpeg', 'application/pdf') or (v_pdf and p_kind <> 'slip') then
    raise exception 'Photos only here. A payment slip can also be a PDF.' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or p_size > (case when v_pdf then 5000000 else 3000000 end) then
    raise exception '%', (case when v_pdf then 'PDFs can be up to 5 MB.' else 'Photos can be up to 3 MB.' end) using errcode = '22023';
  end if;
  perform messaging.hit_limit('shop_upload', 80, 'You have uploaded a lot of photos today. Try again tomorrow.');
  v_path := 'shop/' || v_uid || '/' || ops.uuid_v7() || case when v_pdf then '.pdf' else '.jpg' end;
  insert into shop.uploads (path, user_id, kind, size, mime, checked) values (v_path, v_uid, p_kind, p_size, p_mime, not v_pdf);
  return jsonb_build_object('path', v_path, 'mime', p_mime);
end;
$$;

-- For the media function: the caller's own PDF waiting for its check (its path and size).
create or replace function api.shop_upload_to_check(p_path text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('path', u.path, 'size', u.size, 'mime', u.mime)
  from shop.uploads u
  where u.path = p_path and u.user_id = (select auth.uid()) and not u.checked and u.mime = 'application/pdf'
    and (select identity.is_active_user());
$$;

-- The media function's verdict (service role): clean PDFs can be used; others are forgotten.
create or replace function api.shop_upload_checked(p_path text, p_ok boolean)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update shop.uploads u set checked = true where u.path = p_path and p_ok;
  delete from shop.uploads u where u.path = p_path and not p_ok and u.order_id is null and u.listing_id is null;
$$;

-- Places the caller's order, or changes it while no rep has confirmed it (a rejected order goes back
-- to the reps). p_lines: [{ "size": "M", "quantity": 2 }] (size null when the item has no sizes).
-- A PDF slip must have passed its check.
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
       where u.path = v_slip and u.user_id = v_uid and u.kind = 'slip' and u.listing_id is null and u.checked
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

-- ---------------------------------------------------------------------------------------------
-- Reminders and privileges
-- ---------------------------------------------------------------------------------------------

select cron.schedule('kuppi-reminders', '*/5 * * * *', $$select kuppi.send_reminders()$$);
select cron.schedule('exam-reminders', '30 12 * * *', $$select academics.send_exam_reminders()$$); -- 6 pm in Sri Lanka
select cron.schedule('shop-reminders', '7 * * * *', $$select shop.send_reminders()$$);

revoke execute on function messaging.notify(uuid[], text, text, text, jsonb, text, text, interval, boolean) from public, anon, authenticated;
revoke execute on function messaging.when_text(timestamptz) from public, anon, authenticated;
revoke execute on function messaging.module_students(bigint, bigint) from public, anon, authenticated;
revoke execute on function kuppi.session_created() from public, anon, authenticated;
revoke execute on function kuppi.session_cancelled() from public, anon, authenticated;
revoke execute on function kuppi.send_reminders() from public, anon, authenticated;
revoke execute on function academics.exam_label(text) from public, anon, authenticated;
revoke execute on function academics.exam_changed() from public, anon, authenticated;
revoke execute on function academics.send_exam_reminders() from public, anon, authenticated;
revoke execute on function shop.order_cancelled() from public, anon, authenticated;
revoke execute on function shop.listing_hidden() from public, anon, authenticated;
revoke execute on function shop.lead_appointed() from public, anon, authenticated;
revoke execute on function shop.send_reminders() from public, anon, authenticated;
revoke execute on function shop.listing_renewed() from public, anon, authenticated;
revoke execute on function content.resource_checked() from public, anon, authenticated;
revoke execute on function content.comment_added() from public, anon, authenticated;
revoke execute on function identity.account_changed() from public, anon, authenticated;

revoke execute on function api.begin_shop_upload(text, integer, text) from public, anon;
grant execute on function api.begin_shop_upload(text, integer, text) to authenticated;
revoke execute on function api.shop_upload_to_check(text) from public, anon;
grant execute on function api.shop_upload_to_check(text) to authenticated;
revoke execute on function api.shop_upload_checked(text, boolean) from public, anon, authenticated;
grant execute on function api.shop_upload_checked(text, boolean) to service_role;
