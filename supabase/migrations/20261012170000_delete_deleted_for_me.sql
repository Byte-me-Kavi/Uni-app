-- "Delete for me" also works on a message already deleted for everyone, so its "This message was
-- deleted" placeholder can be cleared from your own view, as in WhatsApp. Deleting for everyone is
-- unchanged (only your own, visible message, within 2 days).

create or replace function api.delete_message(p_conversation_id uuid, p_message_id uuid, p_for_everyone boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_message messaging.messages;
begin
  if not coalesce(p_for_everyone, false) then
    -- Any message in a chat you are in, deleted or not.
    if v_uid is null or not messaging.is_member(p_conversation_id) or not exists (
      select 1 from messaging.messages m where m.id = p_message_id and m.conversation_id = p_conversation_id
    ) then
      raise exception 'That message is not available.' using errcode = '22023';
    end if;
    insert into messaging.hidden_messages (user_id, message_id, conversation_id)
    values (v_uid, p_message_id, p_conversation_id) on conflict do nothing;
    delete from messaging.starred_messages s where s.user_id = v_uid and s.message_id = p_message_id;
    return;
  end if;

  v_message := messaging.visible_message(p_conversation_id, p_message_id);
  if v_uid is null or v_message.id is null then
    raise exception 'That message is not available.' using errcode = '22023';
  end if;
  if v_message.sender_id is distinct from v_uid then
    raise exception 'You can only delete your own messages for everyone.' using errcode = '42501';
  end if;
  if v_message.created_at < now() - interval '2 days' then
    raise exception 'Messages can be deleted for everyone for 2 days after sending.' using errcode = '22023';
  end if;

  update messaging.messages m set deleted_at = clock_timestamp(), body = '', attachment = null, link = null, reply = null
  where m.id = p_message_id and m.created_at = v_message.created_at;
  delete from messaging.message_reactions x where x.message_id = p_message_id;
  delete from messaging.starred_messages s where s.message_id = p_message_id;
  update messaging.conversations c set last_message_preview = 'This message was deleted'
  where c.id = p_conversation_id and c.last_message_id = p_message_id;
  update messaging.conversations c set pinned_message_id = null, pinned_at = null, pinned_by = null
  where c.id = p_conversation_id and c.pinned_message_id = p_message_id;

  perform messaging.broadcast(p_conversation_id, 'delete',
    jsonb_build_object('conversation_id', p_conversation_id, 'message_id', p_message_id));
end;
$$;
grant execute on function api.delete_message(uuid, uuid, boolean) to authenticated;
