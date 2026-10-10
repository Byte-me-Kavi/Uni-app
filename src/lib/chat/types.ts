// One row of the chat list (api.my_chats).
export type Chat = {
  conversation_id: string;
  kind: 'direct' | 'group' | 'cohort' | 'programme' | 'module' | 'kuppi';
  title: string | null;
  other_user_id: string | null;
  other_avatar_path: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_sender_id: string | null;
  last_sender_name: string | null;
  unread: number;
  muted: boolean;
  /** Direct chats only: a message request waiting on the recipient. */
  request: 'incoming' | 'outgoing' | null;
  member_count: number;
  my_last_read_at: string | null;
  other_last_read_at: string | null;
  created_at: string;
};

export type MessageStatus = 'pending' | 'sent' | 'failed';

export type Message = {
  /** UUIDv7 made on the phone, so a retried send is recognised by the server. */
  id: string;
  conversation_id: string;
  sender_id: string | null;
  sender_name: string | null;
  sender_avatar: string | null;
  body: string | null;
  reply_to_id: string | null;
  /** Server time, exactly as the server wrote it (used as the sync cursor). */
  created_at: string;
  /** Milliseconds, for ordering. */
  ts: number;
  status: MessageStatus;
  /** Why a message failed, for the "not sent" note. */
  error: string | null;
  deleted: boolean;
};

// What api.send_message broadcasts.
export type MessagePayload = {
  id: string;
  conversation_id: string;
  kind: Chat['kind'];
  sender_id: string;
  sender_name: string | null;
  sender_avatar: string | null;
  body: string;
  reply_to_id: string | null;
  created_at: string;
};
