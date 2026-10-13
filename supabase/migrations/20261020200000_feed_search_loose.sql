-- Feed search finds near matches, not only exact ones. A post shows when any of the words is in it
-- (anywhere, so "laniya" finds "Kelaniya"), or is close to a word in it (a typo like "kelanya", for
-- words of 4 letters or more). Posts matching more of the words, matching them exactly, or newer,
-- come first. pg_trgm (in the extensions schema since the foundations) does the near matching.

alter table feed.posts add column search_text text generated always as (
  lower(body || ' ' || coalesce(details ->> 'where', '') || ' ' || coalesce(details ->> 'area', '') || ' '
    || coalesce(details ->> 'role', '') || ' ' || coalesce(notice_from, ''))
) stored;
create index posts_search_text_idx on feed.posts using gin (search_text extensions.gin_trgm_ops) where status = 'live';

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
  -- Up to 6 words of 2 letters or more, without characters that mean something to tsquery or LIKE.
  select array_agg(w) into v_words
  from (
    select clean.w from unnest(regexp_split_to_array(lower(btrim(coalesce(p_query, ''))), '\s+')) as raw(w0),
      lateral (select regexp_replace(raw.w0, '[&|!():*<>''"\\%_]', '', 'g') as w) clean
    where char_length(clean.w) >= 2
    limit 6
  ) words;
  if v_words is null then
    return jsonb_build_object('ids', '[]'::jsonb, 'posts', '[]'::jsonb);
  end if;
  -- Every word, as the start of a word: the best matches.
  v_query := to_tsquery('simple', (select string_agg(quote_literal(w) || ':*', ' & ') from unnest(v_words) as w));

  select coalesce(array_agg(x.id order by x.score desc, x.id desc), '{}') into v_ids
  from (
    select m.id,
      (m.hits / cardinality(v_words) + case when m.exact then 1 else 0 end)
        / power(extract(epoch from now() - m.created_at) / 86400 + 7, 0.3)
        * case when m.institution_id = v_institution then 1.5 else 1 end
        * case when m.resolved_at is null then 1 else 0.6 end as score
    from (
      select p.id, p.created_at, p.institution_id, p.resolved_at, p.search @@ v_query as exact,
        -- Per word: 1 when it is in the post, less for a near spelling, nothing otherwise.
        (select sum(case
                      when p.search_text like '%' || w || '%' then 1.0
                      when char_length(w) >= 4 then greatest(extensions.word_similarity(w, p.search_text) - 0.45, 0) / 0.55
                      else 0 end)
         from unnest(v_words) as w) as hits
      from feed.posts p
      where p.status = 'live'
        and (p.institution_id = v_institution or p.audience = 'everyone')
        and p.created_at > now() - interval '1 year'
        and (p_tag is null or p.tag = p_tag)
        and not exists (select 1 from feed.hidden h where h.user_id = v_uid and h.post_id = p.id)
        and not exists (select 1 from feed.mutes mu where mu.user_id = v_uid and mu.author_id = p.author_id)
        and not feed.blocked(p.author_id, v_uid)
    ) m
    where m.hits > 0
    order by score desc, m.id desc
    limit 100
  ) x;

  return jsonb_build_object('ids', to_jsonb(v_ids), 'posts', feed.posts_for(v_ids[1:15], v_uid, v_institution));
end;
$$;
revoke execute on function api.search_posts(text, text) from public, anon;
grant execute on function api.search_posts(text, text) to authenticated;
