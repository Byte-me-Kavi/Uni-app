-- Files in a kuppi open to all universities are filed under the host's module, which belongs to
-- another university for some of the students there. For them, the item goes to their own module on
-- the same national subject (or To sort when they take none).

-- The module an item filed under p_module_id belongs in for a student: the module itself at their
-- university, else their module on the same subject (this semester's first), else null.
create or replace function content.my_module_for(p_uid uuid, p_module_id bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_module_id is null then null
    when (select m.institution_id from academics.modules m where m.id = p_module_id)
         = (select p.institution_id from identity.profiles p where p.user_id = p_uid) then p_module_id
    else (select m.module_id from content.my_modules_for(p_uid) m
          where academics.subject_of(m.module_id) = academics.subject_of(p_module_id)
          order by m.is_current desc, m.module_id limit 1)
  end;
$$;
revoke execute on function content.my_module_for(uuid, bigint) from public, anon, authenticated;

create or replace function content.my_items(p_uid uuid)
returns table (message_id uuid, k text, created_at timestamptz, module_id bigint, codes text[], my_module bigint, title text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as materialized (
    select p.institution_id from identity.profiles p where p.user_id = p_uid
  ), raw as (
    select i.message_id, coalesce(i.sha256, i.path, i.url) as k, i.created_at, i.module_id, i.codes, li.module_id as my_module, i.title
    from content.chat_items i
    left join content.library_items li on li.user_id = p_uid and li.message_id = i.message_id
    where i.conversation_id in (select cm.conversation_id from messaging.conversation_members cm where cm.user_id = p_uid)
      and i.deleted_at is null
      and (i.auto or li.message_id is not null)
      and not coalesce(li.hidden, false)
      and not exists (select 1 from messaging.hidden_messages h where h.user_id = p_uid and h.message_id = i.message_id)
      and not exists (select 1 from safety.blocks b where b.blocker_id = p_uid and b.blocked_id = i.sender_id)
    union
    select i.message_id, coalesce(i.sha256, i.path, i.url), i.created_at, i.module_id, i.codes, li.module_id, i.title
    from content.library_items li
    join content.chat_items i on i.message_id = li.message_id
    where li.user_id = p_uid and li.saved and not li.hidden and i.deleted_at is null
      and not exists (select 1 from messaging.hidden_messages h where h.user_id = p_uid and h.message_id = i.message_id)
      and not exists (select 1 from safety.blocks b where b.blocker_id = p_uid and b.blocked_id = i.sender_id)
  )
  select r.message_id, r.k, r.created_at,
    case when r.module_id is null or mo.institution_id = (select me.institution_id from me) then r.module_id
         else content.my_module_for(p_uid, r.module_id) end,
    r.codes, r.my_module, r.title
  from raw r
  left join academics.modules mo on mo.id = r.module_id;
$$;

create or replace function content.module_items(p_uid uuid, p_module_id bigint, p_key text)
returns table (message_id uuid, category text, created_at timestamptz, pinned_at timestamptz, item jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with elsewhere as (
    -- The same subject's modules at other universities (items from kuppi open to all universities).
    select mo.id from academics.modules mo
    where mo.subject_id in (select s.id from academics.subjects s
                            where s.id = academics.subject_of(p_module_id) or s.merged_into_id = academics.subject_of(p_module_id))
      and mo.institution_id <> (select x.institution_id from academics.modules x where x.id = p_module_id)
  ), candidates as (
    select i.message_id from content.chat_items i
    where i.conversation_id in (select cm.conversation_id from messaging.conversation_members cm where cm.user_id = p_uid)
      and i.deleted_at is null
      and (i.module_id = p_module_id
           or (i.module_id is null and i.codes @> array[p_key])
           or (i.module_id in (select e.id from elsewhere e) and content.my_module_for(p_uid, i.module_id) = p_module_id))
    union
    select li.message_id from content.library_items li
    join content.chat_items i on i.message_id = li.message_id
    where li.user_id = p_uid and i.deleted_at is null
      and (li.module_id = p_module_id
           or (li.module_id is null and li.saved
               and (i.module_id = p_module_id or (i.module_id is null and i.codes @> array[p_key])
                    or (i.module_id in (select e.id from elsewhere e) and content.my_module_for(p_uid, i.module_id) = p_module_id))))
  )
  select v.message_id, v.category, v.created_at, v.pinned_at, v.item
  from (
    -- The same content (fingerprint), or the same file or link, shows once: the copy the student
    -- acted on, else the newest.
    select distinct on (coalesce(i.sha256, i.path, i.url))
      i.message_id, coalesce(li.category, i.category) as category, i.created_at, li.pinned_at,
      content.item_json(i, li) || jsonb_build_object(
        'can_share', i.kind in ('file', 'image')
          and content.resource_ext(i.mime) is not null
          and (i.sender_id = p_uid or exists (
            select 1 from messaging.conversation_members cm join messaging.conversations c on c.id = cm.conversation_id
            where cm.conversation_id = i.conversation_id and cm.user_id = p_uid and cm.role = 'admin' and c.kind = 'cohort'))
          and not exists (select 1 from content.resources r where r.source_message_id = i.message_id and r.deleted_at is null)) as item
    from candidates c
    join content.chat_items i on i.message_id = c.message_id
    left join content.library_items li on li.user_id = p_uid and li.message_id = i.message_id
    where i.deleted_at is null
      and (li.saved or exists (select 1 from messaging.conversation_members cm
                               where cm.conversation_id = i.conversation_id and cm.user_id = p_uid))
      and (i.auto or li.message_id is not null)
      and not coalesce(li.hidden, false)
      and (li.module_id is null or li.module_id = p_module_id)
      and not exists (select 1 from messaging.hidden_messages h where h.user_id = p_uid and h.message_id = i.message_id)
      and not exists (select 1 from safety.blocks b where b.blocker_id = p_uid and b.blocked_id = i.sender_id)
    order by coalesce(i.sha256, i.path, i.url), (li.message_id is not null) desc, i.created_at desc
  ) v;
$$;

-- "Save to Resources" in a chat: the module it is filed in for the student.
create or replace function api.library_item(p_message_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_item content.chat_items;
  v_mine content.library_items;
  v_module bigint;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select i.* into v_item from content.chat_items i where i.message_id = p_message_id and i.deleted_at is null;
  select li.* into v_mine from content.library_items li where li.user_id = v_uid and li.message_id = p_message_id;
  if v_item.message_id is null or not (messaging.is_member(v_item.conversation_id) or coalesce(v_mine.saved, false)) then
    return null;
  end if;
  v_module := coalesce(v_mine.module_id, content.my_module_for(v_uid, v_item.module_id), (
    select m.module_id from content.my_modules_for(v_uid) m
    where v_item.codes @> array[m.code_key] order by m.is_current desc, m.module_id limit 1));
  return content.item_json(v_item, v_mine) || jsonb_build_object(
    'module_id', v_module,
    'in_library', not coalesce(v_mine.hidden, false) and (v_item.auto or v_mine.message_id is not null),
    'saved', coalesce(v_mine.saved, false));
end;
$$;
grant execute on function api.library_item(uuid) to authenticated;

-- The folder tags on a chat's messages, as the student files them.
create or replace function api.chat_folders(p_conversation_id uuid, p_message_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint;
begin
  if v_uid is null or not (select identity.is_active_user()) or not messaging.is_member(p_conversation_id) then
    raise exception 'You are not in this chat.' using errcode = '42501';
  end if;
  v_institution := (select identity.current_institution_id());
  return coalesce((
    with mine as materialized (
      select * from content.my_modules_for(v_uid)
    )
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'message_id', x.message_id,
      'module_id', x.module_id,
      'code', (select m.code from academics.modules m where m.id = x.module_id),
      'category', x.category,
      'blocked', x.blocked,
      'reason', x.reason)))
    from (
      select i.message_id,
        case when i.check_status = 'blocked' then null
             else coalesce(li.module_id,
               case when mo.institution_id = v_institution then i.module_id else content.my_module_for(v_uid, i.module_id) end,
               (select m.module_id from mine m where i.codes @> array[m.code_key]
                order by m.is_current desc, m.module_id limit 1)) end as module_id,
        coalesce(li.category, i.category) as category,
        i.check_status = 'blocked' as blocked,
        case when i.check_status = 'blocked' then i.check_reason end as reason
      from content.chat_items i
      left join content.library_items li on li.user_id = v_uid and li.message_id = i.message_id
      left join academics.modules mo on mo.id = i.module_id
      where i.conversation_id = p_conversation_id
        and i.message_id = any (p_message_ids[1:200])
        and (i.check_status = 'blocked'
             or (i.deleted_at is null and not coalesce(li.hidden, false) and (i.auto or li.message_id is not null)))
    ) x
    where x.blocked or x.module_id is not null), '[]'::jsonb);
end;
$$;
grant execute on function api.chat_folders(uuid, uuid[]) to authenticated;
