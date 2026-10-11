import type { RealtimeChannel } from '@supabase/supabase-js';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { previewText, uploadAttachment } from '@/lib/chat/attachments';
import { micros } from '@/lib/chat/format';
import { openLocalDb, type LocalDb } from '@/lib/chat/local-db';
import { getChatState, resetChatState, setChatState } from '@/lib/chat/store';
import type {
  Attachment,
  Chat,
  FileAttachment,
  ImageAttachment,
  Message,
  MessageKind,
  MessagePayload,
  PollPayload,
  PollResult,
} from '@/lib/chat/types';
import { uuidv7 } from '@/lib/chat/uuid';
import { supabase } from '@/lib/supabase';

// The chat engine. One live connection while the app is in the foreground:
//   user:<me>        always: direct messages and read receipts arrive here.
//   chat:<id>        only for the chat on screen: group messages, and typing in direct chats.
// Group messages are not followed live from the list (that would count a Realtime message per
// member for every message); the list refreshes when Chats is opened, on reconnect and on return
// to the app. The database is the source of truth: whenever the connection (re)joins, the engine
// fetches what it missed. Messages are written to the phone first and sent from an outbox, so
// they survive a lost connection or a closed app, and a retry can never send one twice.

const PAGE = 50;
const CATCH_UP_PAGE = 200;
const CATCH_UP_MAX_PAGES = 5; // after more than 1,000 missed messages, jump to the newest instead
const GROUP_KEEP = 1000; // messages kept on the phone per group; direct chats are kept whole
const BACKGROUND_DISCONNECT_MS = 30_000;
const TYPING_SEND_EVERY_MS = 4000;
const TYPING_SHOW_MS = 5000;
const READ_EVERY_MS = 2000;

let db: LocalDb | null = null;
let me: string | null = null;
let inbox: RealtimeChannel | null = null;
let open: { id: string; channel: RealtimeChannel | null } | null = null;
let appStateSub: NativeEventSubscription | null = null;
let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 2000;
let flushing = false;
let generation = 0; // async work from a previous account is ignored
const lastTypingSent: Record<string, number> = {};
const readTimers: Record<string, ReturnType<typeof setTimeout>> = {};
const readUpTo: Record<string, string> = {};

const tsOf = (iso: string) => Date.parse(iso);
const activity = (c: Chat) => c.last_message_at ?? c.created_at;
const sortChats = (chats: Chat[]) => [...chats].sort((a, b) => (activity(a) < activity(b) ? 1 : -1));

type Row = {
  id: string;
  sender_id: string | null;
  sender_name: string | null;
  sender_avatar: string | null;
  body: string | null;
  reply_to_id: string | null;
  created_at: string;
  deleted: boolean;
  kind: MessageKind | null;
  attachment: Attachment | null;
};

const fromRow = (conversationId: string, r: Row): Message => ({
  id: r.id,
  conversation_id: conversationId,
  sender_id: r.sender_id,
  sender_name: r.sender_name,
  sender_avatar: r.sender_avatar,
  body: r.body,
  reply_to_id: r.reply_to_id,
  created_at: r.created_at,
  ts: tsOf(r.created_at),
  status: 'sent',
  error: null,
  deleted: r.deleted,
  kind: r.kind ?? 'text',
  attachment: r.attachment ?? null,
});

const fromPayload = (p: MessagePayload): Message => ({
  id: p.id,
  conversation_id: p.conversation_id,
  sender_id: p.sender_id,
  sender_name: p.sender_name,
  sender_avatar: p.sender_avatar,
  body: p.body,
  reply_to_id: p.reply_to_id,
  created_at: p.created_at,
  ts: tsOf(p.created_at),
  status: 'sent',
  error: null,
  deleted: false,
  kind: p.message_kind ?? 'text',
  attachment: p.attachment ?? null,
});

// ---------------------------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------------------------

function putMessages(conversationId: string, incoming: Message[], replace = false) {
  setChatState((s) => {
    const current = s.messages[conversationId];
    if (!current && !replace) return {};
    const byId = new Map((replace ? [] : current ?? []).map((m) => [m.id, m]));
    for (const m of incoming) byId.set(m.id, m);
    const next = [...byId.values()].sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : -1));
    return { messages: { ...s.messages, [conversationId]: next } };
  });
}

function updateChat(conversationId: string, update: (c: Chat) => Chat) {
  setChatState((s) => ({ chats: sortChats(s.chats.map((c) => (c.conversation_id === conversationId ? update(c) : c))) }));
}

const isPermanent = (code: string | undefined) =>
  !!code && /^[0-9A-Z]{5}$/.test(code) && code !== 'PT429' && !code.startsWith('PGRST');

// ---------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------

// Starting and stopping run strictly one after another. React mounts effects twice in development
// and Fast Refresh restarts them, so without this queue a second "open database" could begin while
// the first was still setting up the file, and SQLite answers "database is locked".
let lifecycle: Promise<void> = Promise.resolve();

export function startChat(userId: string) {
  const run = generation;
  lifecycle = lifecycle
    .then(() => (run === generation ? start(userId) : undefined))
    .catch((error) => console.warn('[chat] could not start', error));
  return lifecycle;
}

export function stopChat() {
  generation++; // anything still in flight for the old session stops at its next check
  lifecycle = lifecycle.then(stop).catch((error) => console.warn('[chat] could not stop cleanly', error));
  return lifecycle;
}

async function start(userId: string) {
  if (me === userId && db) return;
  await stop();
  const run = generation;
  const local = await openLocalDb(userId);
  if (run !== generation) {
    await local.close();
    return;
  }
  db = local;
  me = userId;
  const chats = sortChats(await local.loadChats());
  setChatState({ me: userId, chats, chatsLoaded: chats.length > 0, connection: 'connecting' });
  appStateSub = AppState.addEventListener('change', onAppState);
  connectInbox();
  refreshChats();
  flushOutbox();
}

async function stop() {
  appStateSub?.remove();
  appStateSub = null;
  if (backgroundTimer) clearTimeout(backgroundTimer);
  if (retryTimer) clearTimeout(retryTimer);
  disconnectLive();
  open = null;
  const closing = db;
  db = null;
  me = null;
  resetChatState();
  await closing?.close();
}

function onAppState(next: AppStateStatus) {
  if (next === 'active') {
    if (backgroundTimer) clearTimeout(backgroundTimer);
    backgroundTimer = null;
    if (!inbox) {
      connectInbox();
      if (open) subscribeOpen(open.id);
    } else {
      catchUp();
    }
  } else if (!backgroundTimer) {
    // Push notifications take over in the background; holding the socket would only use a
    // connection (and battery) nobody is looking at.
    backgroundTimer = setTimeout(() => {
      backgroundTimer = null;
      disconnectLive();
    }, BACKGROUND_DISCONNECT_MS);
  }
}

function disconnectLive() {
  if (inbox) supabase.removeChannel(inbox);
  inbox = null;
  if (open?.channel) supabase.removeChannel(open.channel);
  if (open) open.channel = null;
  setChatState({ connection: 'offline' });
}

async function connectInboxUnsafe() {
  if (!me || inbox) return;
  const run = generation;
  await supabase.realtime.setAuth();
  if (run !== generation || inbox) return;
  inbox = supabase
    .channel(`user:${me}`, { config: { private: true } })
    .on('broadcast', { event: 'message' }, ({ payload }) => receive(payload as MessagePayload))
    .on('broadcast', { event: 'read' }, ({ payload }) => receiveRead(payload as ReadPayload))
    .on('broadcast', { event: 'poll' }, ({ payload }) => receivePoll(payload as PollPayload))
    .subscribe((status) => {
      if (run !== generation) return;
      if (status === 'SUBSCRIBED') {
        setChatState({ connection: 'live' });
        catchUp(); // first join, and every rejoin after a dropped connection
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setChatState({ connection: 'offline' });
      }
    });
}

function catchUp() {
  refreshChats();
  if (open) fetchNewer(open.id);
  flushOutbox();
}

// ---------------------------------------------------------------------------------------------
// Chat list
// ---------------------------------------------------------------------------------------------

async function refreshChatsUnsafe() {
  const run = generation;
  const { data, error } = await supabase.rpc('my_chats');
  if (error || run !== generation || !db) return;
  const chats = sortChats(
    (data as Chat[]).map((c) => {
      if (open?.id !== c.conversation_id) return c;
      // The chat on screen is read; tell the server if it does not know yet.
      if (c.unread > 0 && c.last_message_at) markRead(c.conversation_id, c.last_message_at);
      return { ...c, unread: 0 };
    }),
  );
  // Keep a placeholder for a direct chat opened but not yet messaged.
  const placeholder = getChatState().chats.find(
    (c) => c.conversation_id === open?.id && !chats.some((x) => x.conversation_id === c.conversation_id),
  );
  setChatState({ chats: placeholder ? sortChats([...chats, placeholder]) : chats, chatsLoaded: true });
  await db.saveChats(chats);
}

// ---------------------------------------------------------------------------------------------
// Incoming
// ---------------------------------------------------------------------------------------------

async function receiveUnsafe(p: MessagePayload) {
  if (!db) return;
  const message = fromPayload(p);
  const known = getChatState().messages[p.conversation_id]?.some((m) => m.id === p.id && m.status === 'sent');
  await db.saveMessages([message]);
  putMessages(p.conversation_id, [message]);

  const chat = getChatState().chats.find((c) => c.conversation_id === p.conversation_id);
  if (!chat) {
    refreshChats(); // a new direct chat or request
    return;
  }
  const onScreen = open?.id === p.conversation_id;
  updateChat(p.conversation_id, (c) => ({
    ...c,
    last_message_at: p.created_at,
    last_message_preview: previewText(message.kind, message.body, message.attachment),
    last_sender_id: p.sender_id,
    last_sender_name: p.sender_name,
    unread: p.sender_id === me || onScreen || known ? c.unread : c.unread + 1,
    // Writing means they have seen everything before it, so your earlier messages get ✓✓
    // without a separate read receipt (the server records the same).
    other_last_read_at:
      c.kind === 'direct' && p.sender_id !== me && micros(p.created_at) > micros(c.other_last_read_at)
        ? p.created_at
        : c.other_last_read_at,
    my_last_read_at: p.sender_id === me && micros(p.created_at) > micros(c.my_last_read_at) ? p.created_at : c.my_last_read_at,
  }));
  if (p.sender_id !== me) {
    setChatState((s) => ({ typingUntil: { ...s.typingUntil, [p.conversation_id]: 0 } }));
    if (onScreen) markRead(p.conversation_id, p.created_at);
  }
}

type ReadPayload = { conversation_id: string; user_id: string; last_read_at: string };
function receiveRead(p: ReadPayload) {
  if (p.user_id === me) return;
  updateChat(p.conversation_id, (c) => ({
    ...c,
    other_last_read_at: !c.other_last_read_at || c.other_last_read_at < p.last_read_at ? p.last_read_at : c.other_last_read_at,
  }));
}

// Someone voted. Your own choices stay as they are; only the totals change.
function receivePoll(p: PollPayload) {
  setChatState((s) => ({
    polls: { ...s.polls, [p.message_id]: { counts: p.counts, voters: p.voters, mine: s.polls[p.message_id]?.mine ?? [] } },
  }));
}

function receiveTyping(conversationId: string, payload: { user_id?: string }) {
  if (!payload.user_id || payload.user_id === me) return;
  setChatState((s) => ({ typingUntil: { ...s.typingUntil, [conversationId]: Date.now() + TYPING_SHOW_MS } }));
}

// ---------------------------------------------------------------------------------------------
// One chat
// ---------------------------------------------------------------------------------------------

async function openConversationUnsafe(conversationId: string) {
  if (!db) return;
  if (open?.id !== conversationId) closeConversation();
  open = { id: conversationId, channel: null };
  updateChat(conversationId, (c) => ({ ...c, unread: 0 }));

  // The phone's copy first: on screen in milliseconds, offline too.
  const local = await db.loadMessages(conversationId, undefined, PAGE);
  if (open?.id !== conversationId) return;
  putMessages(conversationId, local, true);
  setChatState((s) => ({ hasOlder: { ...s.hasOlder, [conversationId]: true } }));

  if (inbox) subscribeOpen(conversationId);
  await fetchNewer(conversationId);

  // Messages that reached the phone while you were elsewhere (live, or in an earlier visit) are
  // read now. fetchNewer only marks what it downloads, so without this the server would keep
  // counting them as unread and the sender would never see ✓✓.
  const newest = getChatState().messages[conversationId]?.find((m) => m.status === 'sent');
  if (open?.id === conversationId && newest) markRead(conversationId, newest.created_at);
  loadPolls(conversationId);
}

// Results for the polls loaded in this chat (one request for all of them).
async function loadPollsUnsafe(conversationId: string) {
  const ids = (getChatState().messages[conversationId] ?? [])
    .filter((m) => m.kind === 'poll' && m.status === 'sent' && !m.deleted)
    .slice(0, 100)
    .map((m) => m.id);
  if (ids.length === 0) return;
  const { data, error } = await supabase.rpc('poll_results', { p_conversation_id: conversationId, p_message_ids: ids });
  if (error) return;
  const rows = data as { message_id: string; counts: number[]; voters: number; mine: number[] }[];
  setChatState((s) => {
    const polls = { ...s.polls };
    for (const r of rows) polls[r.message_id] = { counts: r.counts, voters: r.voters, mine: r.mine };
    return { polls };
  });
}

/** Votes on a poll (an empty list takes the vote back). Shows the change at once. */
export async function votePoll(conversationId: string, messageId: string, options: number[], optionCount: number) {
  const before: PollResult = getChatState().polls[messageId] ?? { counts: Array(optionCount).fill(0), voters: 0, mine: [] };
  const counts = before.counts.map((n, i) => n - (before.mine.includes(i) ? 1 : 0) + (options.includes(i) ? 1 : 0));
  const voters = before.voters - (before.mine.length ? 1 : 0) + (options.length ? 1 : 0);
  setChatState((s) => ({ polls: { ...s.polls, [messageId]: { counts, voters, mine: options } } }));
  const { data, error } = await supabase.rpc('vote_poll', {
    p_conversation_id: conversationId,
    p_message_id: messageId,
    p_options: options,
  });
  if (error) {
    setChatState((s) => ({ polls: { ...s.polls, [messageId]: before } }));
    return error.message;
  }
  const result = data as PollResult;
  setChatState((s) => ({ polls: { ...s.polls, [messageId]: result } }));
  return null;
}

function subscribeOpen(conversationId: string) {
  if (!open || open.id !== conversationId || open.channel) return;
  const chat = getChatState().chats.find((c) => c.conversation_id === conversationId);
  // Direct messages already arrive on user:<me>; a direct chat's own channel is only for typing,
  // which needs an accepted chat.
  if (chat?.kind === 'direct' && chat.request) return;
  open.channel = supabase
    .channel(`chat:${conversationId}`, { config: { private: true } })
    .on('broadcast', { event: 'message' }, ({ payload }) => receive(payload as MessagePayload))
    .on('broadcast', { event: 'typing' }, ({ payload }) => receiveTyping(conversationId, payload as { user_id?: string }))
    .on('broadcast', { event: 'poll' }, ({ payload }) => receivePoll(payload as PollPayload))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED' && open?.id === conversationId) fetchNewer(conversationId);
    });
}

/** The chat on screen, if any: notifications for it are not shown (the messages are already there). */
export function currentConversationId() {
  return open?.id ?? null;
}

export function closeConversation() {
  if (!open) return;
  const { id, channel } = open;
  if (channel) supabase.removeChannel(channel);
  open = null;
  const chat = getChatState().chats.find((c) => c.conversation_id === id);
  if (chat && chat.kind !== 'direct') db?.prune(id, GROUP_KEEP).catch(() => {});
  setChatState((s) => {
    const messages = { ...s.messages };
    delete messages[id];
    return { messages };
  });
}

// Everything newer than the phone has, oldest first, in pages.
async function fetchNewerUnsafe(conversationId: string) {
  const local = db;
  if (!local) return;
  const confirmed = await local.latestConfirmed(conversationId);
  if (!confirmed) {
    const { data, error } = await supabase.rpc('chat_messages', { p_conversation_id: conversationId, p_limit: PAGE });
    if (error || db !== local) return;
    const rows = (data as Row[]).map((r) => fromRow(conversationId, r));
    await local.saveMessages(rows);
    putMessages(conversationId, rows);
    setChatState((s) => ({ hasOlder: { ...s.hasOlder, [conversationId]: rows.length === PAGE } }));
    if (rows[0]) markRead(conversationId, rows[0].created_at);
    return;
  }

  let cursor: string = confirmed;
  for (let page = 0; page < CATCH_UP_MAX_PAGES; page++) {
    const { data, error }: { data: unknown; error: unknown } = await supabase.rpc('chat_messages', {
      p_conversation_id: conversationId,
      p_after: cursor,
      p_limit: CATCH_UP_PAGE,
    });
    if (error || db !== local) return;
    const rows = (data as Row[]).map((r) => fromRow(conversationId, r));
    if (rows.length) {
      await local.saveMessages(rows);
      putMessages(conversationId, rows);
      cursor = rows[rows.length - 1].created_at;
      if (open?.id === conversationId) markRead(conversationId, cursor);
    }
    if (rows.length < CATCH_UP_PAGE) return;
  }
  // Far behind (a busy group after days away): start again from the newest messages.
  await local.clearConversation(conversationId);
  putMessages(conversationId, [], true);
  await fetchNewer(conversationId);
}

async function loadOlderUnsafe(conversationId: string) {
  const local = db;
  const loaded = getChatState().messages[conversationId];
  if (!local || !loaded || getChatState().hasOlder[conversationId] === false) return;
  const oldest = loaded[loaded.length - 1];

  const fromPhone = await local.loadMessages(conversationId, oldest?.ts, PAGE);
  if (fromPhone.length) putMessages(conversationId, fromPhone);
  if (fromPhone.length === PAGE) return;

  const before = (fromPhone[fromPhone.length - 1] ?? oldest)?.created_at;
  const { data, error } = await supabase.rpc('chat_messages', {
    p_conversation_id: conversationId,
    p_before: before,
    p_limit: PAGE,
  });
  if (error || db !== local) return;
  const rows = (data as Row[]).map((r) => fromRow(conversationId, r));
  await local.saveMessages(rows);
  putMessages(conversationId, rows);
  setChatState((s) => ({ hasOlder: { ...s.hasOlder, [conversationId]: rows.length === PAGE } }));
}

// Read position, at most once every 2 seconds per chat, and only when it moves forward (so
// opening a chat you have already read sends nothing).
function markRead(conversationId: string, upTo: string) {
  updateChat(conversationId, (c) => ({ ...c, unread: 0 }));
  const chat = getChatState().chats.find((c) => c.conversation_id === conversationId);
  // Looking at a message request must not tell the sender it was seen (no read receipt).
  if (chat?.request === 'incoming') return;
  if (chat && micros(chat.my_last_read_at) >= micros(upTo)) return;
  if (!readUpTo[conversationId] || micros(readUpTo[conversationId]) < micros(upTo)) readUpTo[conversationId] = upTo;
  if (readTimers[conversationId]) return;
  readTimers[conversationId] = setTimeout(() => {
    delete readTimers[conversationId];
    const until = readUpTo[conversationId];
    delete readUpTo[conversationId];
    if (!until) return;
    supabase.rpc('mark_read', { p_conversation_id: conversationId, p_up_to: until }).then(({ data, error }) => {
      if (error) return; // the next open or refresh tries again
      updateChat(conversationId, (c) => ({ ...c, my_last_read_at: (data as string | null) ?? until }));
      const local = db;
      if (local) local.saveChats(getChatState().chats).catch(() => {});
    });
  }, READ_EVERY_MS);
}

// ---------------------------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------------------------

async function sendMessageUnsafe(conversationId: string, body: string) {
  const text = body.trim();
  if (!text || !me || !db) return;
  const now = Date.now();
  const message: Message = {
    id: uuidv7(),
    conversation_id: conversationId,
    sender_id: me,
    sender_name: null,
    sender_avatar: null,
    body: text,
    reply_to_id: null,
    created_at: new Date(now).toISOString(),
    ts: now,
    status: 'pending',
    error: null,
    deleted: false,
    kind: 'text',
    attachment: null,
  };
  await queue(message);
}

/** Sends a photo, document, sticker, poll or contact. Photos and documents upload first, from the
 * outbox, so they survive a lost connection or a closed app like text does. */
async function sendRichUnsafe(conversationId: string, kind: Exclude<MessageKind, 'text'>, attachment: Attachment, caption = '') {
  if (!me || !db) return;
  const now = Date.now();
  await queue({
    id: uuidv7(),
    conversation_id: conversationId,
    sender_id: me,
    sender_name: null,
    sender_avatar: null,
    body: caption.trim(),
    reply_to_id: null,
    created_at: new Date(now).toISOString(),
    ts: now,
    status: 'pending',
    error: null,
    deleted: false,
    kind,
    attachment,
  });
}

async function queue(message: Message) {
  if (!db) return;
  await db.saveMessages([message]);
  putMessages(message.conversation_id, [message]);
  updateChat(message.conversation_id, (c) => ({
    ...c,
    last_message_at: message.created_at,
    last_message_preview: previewText(message.kind, message.body, message.attachment),
    last_sender_id: me,
  }));
  flushOutbox();
}

// What the server keeps of an attachment: never the phone's own file address.
function forServer(attachment: Attachment | null) {
  if (!attachment) return null;
  const { local_uri: _local, ...rest } = attachment as ImageAttachment & FileAttachment;
  return rest;
}

// Uploads a photo or document that has not reached R2 yet. Returns the message ready to send,
// 'wait' when the network failed (the outbox tries again) or 'failed' when it was refused.
async function uploadFirst(local: LocalDb, message: Message): Promise<Message | 'wait' | 'failed'> {
  if (message.kind !== 'image' && message.kind !== 'file') return message;
  const file = message.attachment as ImageAttachment & Partial<FileAttachment>;
  if (file.path || !file.local_uri) return message;
  const setProgress = (share: number) =>
    setChatState((s) => ({ uploads: { ...s.uploads, [message.id]: Math.min(1, Math.max(0, share)) } }));
  setProgress(0);
  const result = await uploadAttachment(
    message.conversation_id,
    message.kind,
    { local_uri: file.local_uri, mime: message.kind === 'image' ? 'image/jpeg' : (file.mime ?? ''), size: file.size },
    setProgress,
  );
  if ('error' in result) {
    if (!result.permanent) return 'wait';
    const failed = { ...message, status: 'failed' as const, error: result.error };
    await local.saveMessages([failed]);
    putMessages(message.conversation_id, [failed]);
    return 'failed';
  }
  // Recorded at once, so a retry after a crash does not upload the file again.
  const uploaded: Message = { ...message, attachment: { ...file, path: result.path } as Attachment };
  await local.saveMessages([uploaded]);
  putMessages(message.conversation_id, [uploaded]);
  return uploaded;
}

async function retryMessageUnsafe(message: Message) {
  if (!db) return;
  const again = { ...message, status: 'pending' as const, error: null };
  await db.saveMessages([again]);
  putMessages(message.conversation_id, [again]);
  flushOutbox();
}

// Sends waiting messages in order. A network failure or rate limit leaves them waiting and
// retries with backoff (2 s, 4 s ... 30 s); a refusal (blocked, request pending) marks them failed.
async function flushOutboxUnsafe() {
  const local = db;
  if (flushing || !local) return;
  flushing = true;
  try {
    for (const waiting of await local.pendingMessages()) {
      const message = await uploadFirst(local, waiting);
      if (db !== local) return;
      if (message === 'failed') continue;
      if (message === 'wait') {
        scheduleRetry();
        return;
      }
      const { data, error } = await supabase.rpc('send_message', {
        p_conversation_id: message.conversation_id,
        p_id: message.id,
        p_body: message.body ?? '',
        p_kind: message.kind,
        p_attachment: forServer(message.attachment) as never,
      });
      if (db !== local) return;
      if (error) {
        if (isPermanent(error.code)) {
          const failed = { ...message, status: 'failed' as const, error: error.message };
          await local.saveMessages([failed]);
          putMessages(message.conversation_id, [failed]);
          continue;
        }
        scheduleRetry();
        return;
      }
      const { created_at: created, attachment } = data as { created_at: string; attachment?: Attachment | null };
      // The server's attachment (checked and completed), plus the phone's own copy of the file.
      const merged = attachment
        ? ({ ...attachment, local_uri: (message.attachment as ImageAttachment | null)?.local_uri } as Attachment)
        : message.attachment;
      const sent: Message = { ...message, attachment: merged, status: 'sent', created_at: created, ts: tsOf(created), error: null };
      setChatState((s) => {
        const uploads = { ...s.uploads };
        delete uploads[message.id];
        return { uploads };
      });
      // The server has it: show ✓ now, then record it on the phone.
      putMessages(message.conversation_id, [sent]);
      // Sending reads the chat up to your message (the server records the same).
      updateChat(message.conversation_id, (c) => ({
        ...c,
        unread: 0,
        my_last_read_at: micros(created) > micros(c.my_last_read_at) ? created : c.my_last_read_at,
        last_message_at:
          c.last_sender_id === me && c.last_message_preview === previewText(message.kind, message.body, message.attachment)
          ? created
          : c.last_message_at,
      }));
      await local.saveMessages([sent]);
    }
    retryDelay = 2000;
  } catch (error) {
    // Anything unexpected (the phone database busy, a dropped connection mid-request): try again
    // shortly. Safe, because the server recognises a message it already saved by its id.
    scheduleRetry();
    throw error;
  } finally {
    flushing = false;
  }
}

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    flushOutbox();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 30_000);
}

// Typing, direct chats only: once when you start, then every 4 seconds while you type.
export function notifyTyping(conversationId: string) {
  if (!open || open.id !== conversationId || !open.channel || !me) return;
  const now = Date.now();
  if (now - (lastTypingSent[conversationId] ?? 0) < TYPING_SEND_EVERY_MS) return;
  const chat = getChatState().chats.find((c) => c.conversation_id === conversationId);
  if (chat?.kind !== 'direct' || chat.request) return;
  lastTypingSent[conversationId] = now;
  open.channel.send({ type: 'broadcast', event: 'typing', payload: { user_id: me } });
}

// ---------------------------------------------------------------------------------------------
// Direct chats and requests
// ---------------------------------------------------------------------------------------------

export async function startDirect(person: { user_id: string; full_name: string; avatar_path: string | null }) {
  const { data, error } = await supabase.rpc('start_direct', { p_user_id: person.user_id });
  if (error) return { error: error.message };
  const { conversation_id, request_status } = data as { conversation_id: string; request_status: string };
  if (!getChatState().chats.some((c) => c.conversation_id === conversation_id)) {
    const now = new Date().toISOString();
    const placeholder: Chat = {
      conversation_id,
      kind: 'direct',
      title: person.full_name,
      other_user_id: person.user_id,
      other_avatar_path: person.avatar_path,
      last_message_at: null,
      last_message_preview: null,
      last_sender_id: null,
      last_sender_name: null,
      unread: 0,
      muted: false,
      request: request_status === 'pending' ? 'outgoing' : null,
      member_count: 2,
      my_last_read_at: null,
      other_last_read_at: null,
      created_at: now,
    };
    setChatState((s) => ({ chats: sortChats([...s.chats, placeholder]) }));
  }
  return { conversationId: conversation_id };
}

/** Mutes a chat's notifications for some hours, or until unmuted (hours null); on false, unmutes. */
export async function setMuted(conversationId: string, on: boolean, hours: number | null = null) {
  const { error } = await supabase.rpc('set_muted', {
    p_conversation_id: conversationId,
    p_on: on,
    ...(hours ? { p_hours: hours } : {}),
  });
  if (error) return error.message;
  updateChat(conversationId, (c) => ({ ...c, muted: on }));
  db?.saveChats(getChatState().chats).catch(() => {});
  return null;
}

export async function respondRequest(conversationId: string, accept: boolean) {
  const { error } = await supabase.rpc('respond_request', { p_conversation_id: conversationId, p_accept: accept });
  if (error) return error.message;
  if (accept) {
    updateChat(conversationId, (c) => ({ ...c, request: null }));
    if (open?.id === conversationId && inbox) subscribeOpen(conversationId); // typing works from now on
  } else setChatState((s) => ({ chats: s.chats.filter((c) => c.conversation_id !== conversationId) }));
  return null;
}

// ---------------------------------------------------------------------------------------------
// Everything that runs in the background (live events, timers, screens that do not wait) goes
// through these wrappers: if the database was closed by a sign-out or the network failed half way,
// the failure is logged and the next sync picks up, instead of surfacing as an uncaught error.
// ---------------------------------------------------------------------------------------------
function safely<A extends unknown[]>(label: string, run: (...args: A) => Promise<unknown>) {
  return (...args: A): Promise<void> =>
    run(...args).then(
      () => undefined,
      (error) => {
        if (__DEV__) console.warn(`[chat] ${label} failed`, error);
      },
    );
}

export const refreshChats = safely('refresh chats', refreshChatsUnsafe);
export const openConversation = safely('open chat', openConversationUnsafe);
export const loadOlder = safely('load older messages', loadOlderUnsafe);
export const sendMessage = safely('send', sendMessageUnsafe);
export const sendRich = safely('send', sendRichUnsafe);
const loadPolls = safely('load polls', loadPollsUnsafe);
export const retryMessage = safely('retry', retryMessageUnsafe);
const receive = safely('receive', receiveUnsafe);
const fetchNewer = safely('catch up', fetchNewerUnsafe);
const flushOutbox = safely('send waiting messages', flushOutboxUnsafe);
const connectInbox = safely('connect', connectInboxUnsafe);
