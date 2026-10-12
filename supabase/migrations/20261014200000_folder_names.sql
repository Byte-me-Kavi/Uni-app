-- The folder tags on a chat's messages, as the student files them, with the module's name (students
-- know modules by name, not code).
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
      'name', (select m.name from academics.modules m where m.id = x.module_id),
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
