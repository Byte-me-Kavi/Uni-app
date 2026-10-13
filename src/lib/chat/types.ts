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
  /** Direct chats: the other phone has received up to here (grey ✓✓). */
  other_delivered_at?: string | null;
  /** The chat's pinned message, if any. */
  pinned?: ReplySnapshot | null;
  /** In batch and programme groups 'admin' is a batch rep; in your own groups, a group admin. */
  my_role?: 'member' | 'admin' | null;
  /** You pinned this chat to the top of your list (up to 3). */
  list_pinned_at?: string | null;
  /** Module and kuppi chats: the module, for its colour. */
  module_id?: number | null;
  /** You moved this chat out of the list, into Archived. */
  archived?: boolean;
  /** Groups: only reps or admins may send. */
  announcement_only?: boolean;
  /** Groups: seconds a member waits between messages (0 = off). Reps and admins are exempt. */
  slow_mode_seconds?: number;
};

/** What a reply (or the pinned bar) shows of another message. */
export type ReplySnapshot = {
  id: string;
  sender_id: string | null;
  sender_name: string | null;
  kind: MessageKind;
  text: string | null;
  thumb?: string | null;
  sticker?: StickerAttachment | null;
};

/** A link preview, made on the sender's phone. */
export type LinkPreview = { url: string; title?: string; description?: string; site?: string; image?: string };

export type MessageStatus = 'pending' | 'sent' | 'failed';

export type MessageKind = 'text' | 'image' | 'file' | 'voice' | 'sticker' | 'poll' | 'contact';

/** A photo. Before upload it has local_uri only; after, path (R2). Your own keep local_uri, so they
 * never download again. thumb: a tiny JPEG shown blurred while the photo loads. */
export type ImageAttachment = {
  path?: string;
  local_uri?: string;
  width: number;
  height: number;
  size: number;
  thumb?: string | null;
};
export type FileAttachment = { path?: string; local_uri?: string; name: string; size: number; mime: string };
/** A voice note: AAC in .m4a. waveform: up to 64 levels from 0 to 15, drawn as bars. */
export type VoiceAttachment = {
  path?: string;
  local_uri?: string;
  size: number;
  mime: string;
  duration: number;
  waveform: number[];
};
/** pack 'fluent' (built in) or 'user' (imported or made, id = SHA-256 of the WebP). */
export type StickerAttachment = { pack: string; id: string; animated?: boolean };
export type PollAttachment = { question: string; options: string[]; multiple: boolean };
export type ContactAttachment =
  | { type: 'student'; user_id: string; name: string; avatar_path: string | null; institution: string }
  | { type: 'phone'; name: string; phones: { label: string; number: string }[] };
export type Attachment =
  ImageAttachment | FileAttachment | VoiceAttachment | StickerAttachment | PollAttachment | ContactAttachment;

/** Live poll results: votes per option, how many voted, and your own choices. */
export type PollResult = { counts: number[]; voters: number; mine: number[] };

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
  kind: MessageKind;
  attachment: Attachment | null;
  reply?: ReplySnapshot | null;
  forwarded?: boolean;
  mentions?: string[] | null;
  link?: LinkPreview | null;
  edited_at?: string | null;
  /** Outbox only: forward this message (the server copies it). */
  forward_from?: string | null;
};

/** One emoji on a message: how many, and whether one is yours. */
export type Reaction = { emoji: string; count: number; mine: boolean };

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
  message_kind?: MessageKind;
  attachment?: Attachment | null;
  reply?: ReplySnapshot | null;
  forwarded?: boolean;
  mentions?: string[] | null;
  link?: LinkPreview | null;
};

// What api.vote_poll broadcasts.
export type PollPayload = { conversation_id: string; message_id: string; counts: number[]; voters: number };
