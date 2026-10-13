-- Searching the feed, and each chat's module for its colour.
--
-- Search: students search posts from Home (a question someone already asked, a bodim in an area,
-- a lost phone). It sees exactly what the feed may show: live posts from their university and
-- posts shared with every university, never hidden, muted or blocked authors. Words match by
-- prefix ("bod" finds "bodim"), across the text, the place (lost and found, bodim, job) and the
-- job's role. The 'simple' configuration keeps Sinhala and Tamil words as they are.
--
-- Chat colours: the chat list colours module and kuppi chats by their module, as on the Resources
-- tab, so api.my_chats now says which module a chat belongs to.

alter table feed.posts add column search tsvector generated always as (
  to_tsvector('simple'::regconfig,
    body || ' ' || coalesce(details ->> 'where', '') || ' ' || coalesce(details ->> 'area', '') || ' '
    || coalesce(details ->> 'role', '') || ' ' || coalesce(notice_from, ''))
) stored;
create index posts_search_idx on feed.posts using gin (search) where status = 'live';

-- Ids of matching posts, best first, and the first page of them. Further pages through
-- api.feed_posts, as for the feed.
create or replace function api.search_posts(p_query text, p_tag text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint := (select identity.current_institution_id());
  v_words text[];
  v_query tsquery;
  v_ids bigint[];
begin
  if v_uid is null or v_institution is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_tag is not null and p_tag not in ('question', 'lost_found', 'notice', 'bodim', 'job') then
    raise exception 'Unknown filter.' using errcode = '22023';
  end if;
  -- Up to 6 words, without the characters that mean something to tsquery.
  select array_agg(w) into v_words
  from (
    select w from unnest(regexp_split_to_array(lower(btrim(coalesce(p_query, ''))), '\s+')) as raw(w0),
      lateral (select regexp_replace(raw.w0, '[&|!():*<>''"\\]', '', 'g') as w) clean
    where clean.w <> ''
    limit 6
  ) words;
  if v_words is null or char_length(array_to_string(v_words, '')) < 2 then
    return jsonb_build_object('ids', '[]'::jsonb, 'posts', '[]'::jsonb);
  end if;
  v_query := to_tsquery('simple', (select string_agg(quote_literal(w) || ':*', ' & ') from unnest(v_words) as w));

  select coalesce(array_agg(x.id order by x.score desc, x.id desc), '{}') into v_ids
  from (
    select p.id,
      ts_rank(p.search, v_query)
        / power(extract(epoch from now() - p.created_at) / 86400 + 7, 0.5)
        * case when p.institution_id = v_institution then 1.5 else 1 end
        * case when p.resolved_at is null then 1 else 0.6 end as score
    from feed.posts p
    where p.status = 'live'
      and p.search @@ v_query
      and (p.institution_id = v_institution or p.audience = 'everyone')
      and p.created_at > now() - interval '1 year'
      and (p_tag is null or p.tag = p_tag)
      and not exists (select 1 from feed.hidden h where h.user_id = v_uid and h.post_id = p.id)
      and not exists (select 1 from feed.mutes m where m.user_id = v_uid and m.author_id = p.author_id)
      and not feed.blocked(p.author_id, v_uid)
    order by score desc, p.id desc
    limit 100
  ) x;

  return jsonb_build_object('ids', to_jsonb(v_ids), 'posts', feed.posts_for(v_ids[1:15], v_uid, v_institution));
end;
$$;
revoke execute on function api.search_posts(text, text) from public, anon;
grant execute on function api.search_posts(text, text) to authenticated;

-- The chat list, as before, with the module of each module and kuppi chat.
drop function api.my_chats();
create function api.my_chats()
returns table (
  conversation_id uuid,
  kind text,
  title text,
  other_user_id uuid,
  other_avatar_path text,
  last_message_at timestamptz,
  last_message_preview text,
  last_sender_id uuid,
  last_sender_name text,
  unread integer,
  muted boolean,
  request text,
  member_count integer,
  my_last_read_at timestamptz,
  other_last_read_at timestamptz,
  created_at timestamptz,
  other_delivered_at timestamptz,
  pinned jsonb,
  my_role text,
  list_pinned_at timestamptz,
  archived boolean,
  announcement_only boolean,
  slow_mode_seconds integer,
  module_id bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  return query
  select c.id, c.kind,
    case when c.kind = 'direct' then op.full_name else c.title end,
    op.user_id, op.avatar_path,
    c.last_message_at, c.last_message_preview, c.last_sender_id, ls.full_name,
    (select count(*)::integer from (
       select 1 from messaging.messages m
       where m.conversation_id = c.id and m.created_at > coalesce(me.last_read_at, me.joined_at)
         and m.sender_id is distinct from v_uid and m.deleted_at is null
       limit 100) u),
    coalesce(me.muted_until > now(), false),
    case
      when d.conversation_id is null or d.request_status = 'accepted' then null
      when d.initiated_by = v_uid then 'outgoing'
      else 'incoming'
    end,
    c.member_count, me.last_read_at, om.last_read_at, c.created_at,
    greatest(om.delivered_at, om.last_read_at),
    (select messaging.reply_snapshot(pm) from messaging.messages pm
     where c.pinned_message_id is not null and pm.id = c.pinned_message_id and pm.conversation_id = c.id
       and pm.deleted_at is null limit 1),
    me.role,
    me.list_pinned_at,
    me.archived_at is not null,
    c.announcement_only,
    c.slow_mode_seconds::integer,
    coalesce(c.module_id, ks.module_id)
  from messaging.conversation_members me
  join messaging.conversations c on c.id = me.conversation_id
  left join messaging.direct_conversations d on d.conversation_id = c.id
  left join identity.profiles op on c.kind = 'direct'
    and op.user_id = case when d.user_low = v_uid then d.user_high else d.user_low end
  left join messaging.conversation_members om on om.conversation_id = c.id and om.user_id = op.user_id
  left join identity.profiles ls on ls.user_id = c.last_sender_id
  left join kuppi.sessions ks on ks.id = c.session_id
  where me.user_id = v_uid
    and (c.kind not in ('direct') or c.last_message_id is not null)
    and not coalesce(d.request_status = 'ignored' and d.initiated_by <> v_uid, false)
    and not exists (select 1 from safety.blocks b where b.blocker_id = v_uid and b.blocked_id = op.user_id)
  order by me.list_pinned_at desc nulls last, coalesce(c.last_message_at, c.created_at) desc;
end;
$$;
revoke execute on function api.my_chats() from public, anon;
grant execute on function api.my_chats() to authenticated;
