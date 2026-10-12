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
  LinkPreview,
  MessagePayload,
  PollPayload,
  PollResult,
  Reaction,
  ReplySnapshot,
} from '@/lib/chat/types';
import { uuidv7 } from '@/lib/chat/uuid';
import { supabase } from '@/lib/supabase';

// The chat engine. One live connection while the app is in the foreground:
//   user:<me>        always: direct messages and read receipts arrive here.
//   chat:<id>        only for the chat on screen: group messages, edits, deletions, pins, polls.
//                    Receive-only: only the database sends on it, so nobody in the chat can fake
//                    an edit or a deletion on someone else's phone.
//   typing:<id>      only for an accepted direct chat on screen: "typing…", the one thing the two
//                    people send each other directly. Nothing else is read from it.
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
const DELIVERED_EVERY_MS = 2000;
const PRESENCE_EVERY_MS = 3 * 60 * 1000; // "online" lasts 4 minutes after the last beat
const KEEP_OPENED = 6; // chats whose newest page stays in memory after you leave them

let db: LocalDb | null = null;
let me: string | null = null;
let inbox: RealtimeChannel | null = null;
let open: { id: string; channel: RealtimeChannel | null; typing: RealtimeChannel | null } | null = null;
let appStateSub: NativeEventSubscription | null = null;
let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 2000;
let flushing = false;
let generation = 0; // async work from a previous account is ignored
const lastTypingSent: Record<string, number> = {};
const readTimers: Record<string, ReturnType<typeof setTimeout>> = {};
const readUpTo: Record<string, string> = {};
const deliveredTimers: Record<string, ReturnType<typeof setTimeout>> = {};
const deliveredUpTo: Record<string, string> = {};
const reactionTimers: Record<string, ReturnType<typeof setTimeout>> = {};
let presenceTimer: ReturnType<typeof setInterval> | null = null;
// Chats recently opened or about to be (newest last). Their newest page stays in memory, kept
// current by live messages, so going back into one draws it complete in the first frame.
let warm: string[] = [];

const tsOf = (iso: string) => Date.parse(iso);
const activity = (c: Chat) => c.last_message_at ?? c.created_at;
// Chats you pinned first (most recently pinned on top), then newest activity.
const sortChats = (chats: Chat[]) =>
  [...chats].sort((a, b) => {
    const pa = a.list_pinned_at ?? '';
    const pb = b.list_pinned_at ?? '';
    if (pa !== pb) return pa < pb ? 1 : -1;
    return activity(a) < activity(b) ? 1 : -1;
  });

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
  reply?: ReplySnapshot | null;
  forwarded?: boolean;
  mentions?: string[] | null;
  link?: LinkPreview | null;
  edited_at?: string | null;
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
  reply: r.reply ?? null,
  forwarded: !!r.forwarded,
  mentions: r.mentions ?? null,
  link: r.link ?? null,
  edited_at: r.edited_at ?? null,
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
  reply: p.reply ?? null,
  forwarded: !!p.forwarded,
  mentions: p.mentions ?? null,
  link: p.link ?? null,
});

// ---------------------------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------------------------

// A message that comes back unchanged (a catch-up page, the phone's copy on reopening) keeps its
// old object, so its bubble is not drawn again; when nothing changed at all, nothing re-renders.
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

function putMessages(conversationId: string, incoming: Message[], replace = false) {
  setChatState((s) => {
    const current = s.messages[conversationId];
    if (!current && !replace) return {};
    const old = new Map((current ?? []).map((m) => [m.id, m]));
    const byId = new Map(replace ? [] : old);
    let changed = !current;
    for (const m of incoming) {
      const before = old.get(m.id);
      if (before && same(before, m)) byId.set(m.id, before);
      else {
        byId.set(m.id, m);
        changed = true;
      }
    }
    if (replace && !changed) changed = [...old.keys()].some((id) => !byId.has(id));
    if (!changed) return {};
    const next = [...byId.values()].sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : -1));
    return { messages: { ...s.messages, [conversationId]: next } };
  });
}

function updateChat(conversationId: string, update: (c: Chat) => Chat) {
  setChatState((s) => {
    const before = s.chats.find((c) => c.conversation_id === conversationId);
    if (!before) return {};
    const after = update(before);
    if (same(before, after)) return {};
    return { chats: sortChats(s.chats.map((c) => (c === before ? after : c))) };
  });
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
  beat(true);
  loadStarred();
}

// "Last seen" and "online": a beat when the app opens, every 3 minutes while it is open, and one
// saying "gone" when it closes. Two or three small writes per session, nothing live.
function beat(active: boolean) {
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = active ? setInterval(() => supabase.rpc('set_presence', { p_active: true }), PRESENCE_EVERY_MS) : null;
  supabase.rpc('set_presence', { p_active: active }).then(() => undefined, () => undefined);
}

/** Resolves once the engine has started (for actions that arrive while the app is starting). */
export function whenChatReady() {
  return lifecycle.then(() => !!db);
}

async function stop() {
  appStateSub?.remove();
  appStateSub = null;
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = null;
  if (backgroundTimer) clearTimeout(backgroundTimer);
  if (retryTimer) clearTimeout(retryTimer);
  disconnectLive();
  open = null;
  warm = [];
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
    beat(true);
    if (!inbox) {
      connectInbox();
      if (open) subscribeOpen(open.id);
    } else {
      catchUp();
    }
  } else if (!backgroundTimer) {
    beat(false);
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
  if (open?.typing) supabase.removeChannel(open.typing);
  if (open) {
    open.channel = null;
    open.typing = null;
  }
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
    .on('broadcast', { event: 'reaction' }, ({ payload }) => receiveReaction(payload as ChangePayload))
    .on('broadcast', { event: 'delete' }, ({ payload }) => receiveDelete(payload as ChangePayload))
    .on('broadcast', { event: 'edit' }, ({ payload }) => receiveEdit(payload as EditPayload))
    .on('broadcast', { event: 'pin' }, ({ payload }) => receivePin(payload as PinPayload))
    .on('broadcast', { event: 'delivered' }, ({ payload }) => receiveDelivered(payload as DeliveredPayload))
    // Added to (or removed from) a group, or made a rep: the chat list changed.
    .on('broadcast', { event: 'chats' }, () => refreshChats())
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
      // Direct messages waiting for you reached this phone: grey ✓✓ for the sender.
      if (c.kind === 'direct' && c.unread > 0 && c.last_message_at && c.last_sender_id !== me) {
        markDelivered(c.conversation_id, c.last_message_at);
      }
      if (open?.id !== c.conversation_id) return c;
      // The chat on screen is read; tell the server if it does not know yet.
      if (c.unread > 0 && c.last_message_at) markRead(c.conversation_id, c.last_message_at);
      return { ...c, unread: 0 };
    }),
  );
  // Keep a placeholder for a direct chat opened but not yet messaged.
  const before = getChatState().chats;
  const placeholder = before.find(
    (c) => c.conversation_id === open?.id && !chats.some((x) => x.conversation_id === c.conversation_id),
  );
  // Unchanged chats keep their old objects, so only the rows that changed are drawn again.
  const old = new Map(before.map((c) => [c.conversation_id, c]));
  const next = (placeholder ? sortChats([...chats, placeholder]) : chats).map((c) => {
    const prev = old.get(c.conversation_id);
    return prev && same(prev, c) ? prev : c;
  });
  const unchanged = next.length === before.length && next.every((c, i) => c === before[i]);
  setChatState(unchanged ? { chatsLoaded: true } : { chats: next, chatsLoaded: true });
  if (!unchanged) await db.saveChats(chats);
}

// ---------------------------------------------------------------------------------------------
// Incoming
// ---------------------------------------------------------------------------------------------

async function receiveUnsafe(p: MessagePayload) {
  if (!db) return;
  const existing = getChatState().messages[p.conversation_id]?.find((m) => m.id === p.id);
  const ownCopy = (existing?.attachment as ImageAttachment | null)?.local_uri;
  const incoming = fromPayload(p);
  // Your own photo or document echoed back: keep the phone's copy so it never downloads again.
  const message =
    ownCopy && incoming.attachment ? { ...incoming, attachment: { ...incoming.attachment, local_uri: ownCopy } as Attachment } : incoming;
  const known = existing?.status === 'sent';
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
    else if (chat.kind === 'direct') markDelivered(p.conversation_id, p.created_at);
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

/** Loads a chat's newest page from the phone into memory ahead of opening it (on touch down),
 *  so the chat screen's first frame already has its messages. */
async function prefetchConversationUnsafe(conversationId: string) {
  const local = db;
  if (!local) return;
  if (getChatState().messages[conversationId]) {
    touchWarm(conversationId);
    return;
  }
  const rows = await local.loadMessages(conversationId, undefined, PAGE);
  if (db !== local || getChatState().messages[conversationId]) return;
  putMessages(conversationId, rows, true);
  setChatState((s) => ({ hasOlder: { ...s.hasOlder, [conversationId]: true } }));
  touchWarm(conversationId);
}

// Remembers a chat as recently used, and lets the oldest beyond KEEP_OPENED leave memory.
function touchWarm(conversationId: string) {
  warm = [...warm.filter((id) => id !== conversationId), conversationId];
  const drop = warm.slice(0, Math.max(0, warm.length - KEEP_OPENED)).filter((id) => id !== open?.id);
  if (!drop.length) return;
  warm = warm.filter((id) => !drop.includes(id));
  setChatState((s) => {
    const messages = { ...s.messages };
    for (const id of drop) delete messages[id];
    return { messages };
  });
}

/**
 * Opens a chat. What the phone has is shown at once; the server catch-up, live channel and read
 * receipt wait for `settled` (the screen's slide-in finishing), so new rows never land while the
 * screen is still moving.
 */
async function openConversationUnsafe(conversationId: string, settled?: Promise<unknown>) {
  if (!db) return;
  if (open?.id !== conversationId) closeConversation();
  open = { id: conversationId, channel: null, typing: null };
  touchWarm(conversationId);

  // The phone's copy first: on screen in milliseconds, offline too. Already in memory when the
  // chat was opened recently or touched on the list.
  if (!getChatState().messages[conversationId]) {
    const local = await db.loadMessages(conversationId, undefined, PAGE);
    if (open?.id !== conversationId) return;
    putMessages(conversationId, local, true);
    setChatState((s) => ({ hasOlder: { ...s.hasOlder, [conversationId]: true } }));
  }

  if (settled) await settled;
  if (open?.id !== conversationId) return;
  updateChat(conversationId, (c) => ({ ...c, unread: 0 }));
  if (inbox) subscribeOpen(conversationId);
  await fetchNewer(conversationId);

  // Messages that reached the phone while you were elsewhere (live, or in an earlier visit) are
  // read now. fetchNewer only marks what it downloads, so without this the server would keep
  // counting them as unread and the sender would never see ✓✓.
  const newest = getChatState().messages[conversationId]?.find((m) => m.status === 'sent');
  if (open?.id === conversationId && newest) markRead(conversationId, newest.created_at);
  loadPolls(conversationId);
  loadReactions(conversationId);
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
    let changed = false;
    for (const r of rows) {
      const next = { counts: r.counts, voters: r.voters, mine: r.mine };
      if (!same(polls[r.message_id], next)) {
        polls[r.message_id] = next;
        changed = true;
      }
    }
    return changed ? { polls } : {};
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
  if (!open || open.id !== conversationId) return;
  const chat = getChatState().chats.find((c) => c.conversation_id === conversationId);
  // A direct chat request: nothing live until it is accepted.
  if (chat?.kind === 'direct' && chat.request) return;
  if (chat?.kind === 'direct' && !open.typing) {
    open.typing = supabase
      .channel(`typing:${conversationId}`, { config: { private: true } })
      .on('broadcast', { event: 'typing' }, ({ payload }) => receiveTyping(conversationId, payload as { user_id?: string }))
      .subscribe();
  }
  if (open.channel) return;
  open.channel = supabase
    .channel(`chat:${conversationId}`, { config: { private: true } })
    .on('broadcast', { event: 'message' }, ({ payload }) => receive(payload as MessagePayload))
    .on('broadcast', { event: 'poll' }, ({ payload }) => receivePoll(payload as PollPayload))
    .on('broadcast', { event: 'reaction' }, ({ payload }) => receiveReaction(payload as ChangePayload))
    .on('broadcast', { event: 'delete' }, ({ payload }) => receiveDelete(payload as ChangePayload))
    .on('broadcast', { event: 'edit' }, ({ payload }) => receiveEdit(payload as EditPayload))
    .on('broadcast', { event: 'pin' }, ({ payload }) => receivePin(payload as PinPayload))
    .on('broadcast', { event: 'settings' }, ({ payload }) => receiveSettings(payload as SettingsPayload))
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
  const { id, channel, typing } = open;
  if (channel) supabase.removeChannel(channel);
  if (typing) supabase.removeChannel(typing);
  open = null;
  const chat = getChatState().chats.find((c) => c.conversation_id === id);
  if (chat && chat.kind !== 'direct') db?.prune(id, GROUP_KEEP).catch(() => {});
  // Keep the newest page in memory for a quick return; older pages load again when scrolled to.
  setChatState((s) => {
    const loaded = s.messages[id];
    if (!loaded || loaded.length <= PAGE) return {};
    return { messages: { ...s.messages, [id]: loaded.slice(0, PAGE) }, hasOlder: { ...s.hasOlder, [id]: true } };
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
  loadReactions(conversationId, rows.map((r) => r.id));
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

type SendOptions = {
  replyTo?: Message | null;
  mentions?: string[];
  link?: LinkPreview | null;
  /** A UUIDv7 made by the caller, when it needs the id before sending (filing a document). */
  id?: string;
};

async function sendMessageUnsafe(conversationId: string, body: string, options: SendOptions = {}) {
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
    created_at: new Date(now).toISOString(),
    ts: now,
    status: 'pending',
    error: null,
    deleted: false,
    kind: 'text',
    attachment: null,
    reply_to_id: options.replyTo?.id ?? null,
    reply: options.replyTo ? snapshot(options.replyTo) : null,
    mentions: options.mentions?.length ? options.mentions : null,
    link: options.link ?? null,
  };
  await queue(message);
}

// What a reply shows of the message it answers (the server makes the same).
function snapshot(m: Message): ReplySnapshot {
  return {
    id: m.id,
    sender_id: m.sender_id,
    sender_name: m.sender_id === me ? null : m.sender_name,
    kind: m.kind,
    text: m.kind === 'text' ? (m.body ?? '').slice(0, 200) : previewText(m.kind, m.body, m.attachment),
    thumb: m.kind === 'image' ? ((m.attachment as ImageAttachment | null)?.thumb ?? null) : null,
    sticker: m.kind === 'sticker' ? (m.attachment as ReplySnapshot['sticker']) : null,
  };
}

/** Sends a photo, document, sticker, poll or contact. Photos and documents upload first, from the
 * outbox, so they survive a lost connection or a closed app like text does. */
async function sendRichUnsafe(
  conversationId: string,
  kind: Exclude<MessageKind, 'text'>,
  attachment: Attachment,
  caption = '',
  options: SendOptions = {},
) {
  if (!me || !db) return;
  const now = Date.now();
  await queue({
    reply_to_id: options.replyTo?.id ?? null,
    reply: options.replyTo ? snapshot(options.replyTo) : null,
    id: options.id ?? uuidv7(),
    conversation_id: conversationId,
    sender_id: me,
    sender_name: null,
    sender_avatar: null,
    body: caption.trim(),
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
  if ((message.kind !== 'image' && message.kind !== 'file' && message.kind !== 'voice') || message.forward_from) return message;
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
        p_reply_to_id: message.reply_to_id ?? undefined,
        p_forward_from: message.forward_from ?? undefined,
        p_mentions: message.mentions ?? undefined,
        p_link: (message.link ?? undefined) as never,
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
      const { created_at: created, attachment, reply } = data as {
        created_at: string;
        attachment?: Attachment | null;
        reply?: ReplySnapshot | null;
      };
      // The server's attachment (checked and completed), plus the phone's own copy of the file.
      const merged = attachment
        ? ({ ...attachment, local_uri: (message.attachment as ImageAttachment | null)?.local_uri } as Attachment)
        : message.attachment;
      const sent: Message = {
        ...message,
        attachment: merged,
        reply: reply === undefined ? message.reply : reply,
        forward_from: null,
        status: 'sent',
        created_at: created,
        ts: tsOf(created),
        error: null,
      };
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
  if (!open || open.id !== conversationId || !open.typing || !me) return;
  const now = Date.now();
  if (now - (lastTypingSent[conversationId] ?? 0) < TYPING_SEND_EVERY_MS) return;
  const chat = getChatState().chats.find((c) => c.conversation_id === conversationId);
  if (chat?.kind !== 'direct' || chat.request) return;
  lastTypingSent[conversationId] = now;
  open.typing.send({ type: 'broadcast', event: 'typing', payload: { user_id: me } });
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

/** Pins a chat to the top of your list, or archives it. Shows at once; undone if it fails. */
export async function setChatListState(conversationId: string, change: { pinned?: boolean; archived?: boolean }) {
  const before = getChatState().chats.find((c) => c.conversation_id === conversationId);
  if (!before) return null;
  updateChat(conversationId, (c) => ({
    ...c,
    list_pinned_at: change.archived ? null : change.pinned === undefined ? c.list_pinned_at : change.pinned ? new Date().toISOString() : null,
    archived: change.archived ?? c.archived,
  }));
  const { error } = await supabase.rpc('set_chat_state', {
    p_conversation_id: conversationId,
    ...(change.pinned !== undefined ? { p_pinned: change.pinned } : {}),
    ...(change.archived !== undefined ? { p_archived: change.archived } : {}),
  });
  if (error) {
    updateChat(conversationId, () => before);
    return error.message;
  }
  db?.saveChats(getChatState().chats).catch(() => {});
  return null;
}

/** Applies new group settings locally (after the server accepted them). */
export function applyChatSettings(conversationId: string, settings: Partial<Pick<Chat, 'slow_mode_seconds' | 'announcement_only' | 'title' | 'my_role'>>) {
  updateChat(conversationId, (c) => ({ ...c, ...settings }));
  db?.saveChats(getChatState().chats).catch(() => {});
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
// Delivered, reactions, edits, deletes, pins, stars, forwards
// ---------------------------------------------------------------------------------------------

// Direct chats: tells the sender their messages reached this phone (grey ✓✓), at most every 2 s.
function markDelivered(conversationId: string, upTo: string) {
  if (!deliveredUpTo[conversationId] || micros(deliveredUpTo[conversationId]) < micros(upTo)) deliveredUpTo[conversationId] = upTo;
  if (deliveredTimers[conversationId]) return;
  deliveredTimers[conversationId] = setTimeout(() => {
    delete deliveredTimers[conversationId];
    const until = deliveredUpTo[conversationId];
    delete deliveredUpTo[conversationId];
    if (until) supabase.rpc('mark_delivered', { p_conversation_id: conversationId, p_up_to: until }).then(() => undefined, () => undefined);
  }, DELIVERED_EVERY_MS);
}

type ChangePayload = { conversation_id: string; message_id: string; user_id?: string; emoji?: string | null };
type EditPayload = { conversation_id: string; message_id: string; body: string; edited_at: string };
type PinPayload = { conversation_id: string; pinned: ReplySnapshot | null };
type SettingsPayload = { conversation_id: string; slow_mode_seconds: number; announcement_only: boolean; title: string | null };

// A rep or admin changed the group's settings: who may send, slow mode, its name.
function receiveSettings(p: SettingsPayload) {
  updateChat(p.conversation_id, (c) => ({
    ...c,
    slow_mode_seconds: p.slow_mode_seconds,
    announcement_only: p.announcement_only,
    title: p.title ?? c.title,
  }));
}
type DeliveredPayload = { conversation_id: string; user_id: string; delivered_at: string };

function receiveDelivered(p: DeliveredPayload) {
  if (p.user_id === me) return;
  updateChat(p.conversation_id, (c) => ({
    ...c,
    other_delivered_at: micros(p.delivered_at) > micros(c.other_delivered_at) ? p.delivered_at : c.other_delivered_at,
  }));
}

function receivePin(p: PinPayload) {
  updateChat(p.conversation_id, (c) => ({ ...c, pinned: p.pinned }));
}

// Someone reacted: fetch that message's totals once things settle (a burst of reactions on a
// popular message becomes one request).
function receiveReaction(p: ChangePayload) {
  if (p.user_id === me) return; // yours are already on screen
  if (!getChatState().messages[p.conversation_id]?.some((m) => m.id === p.message_id)) return;
  if (reactionTimers[p.message_id]) return;
  reactionTimers[p.message_id] = setTimeout(() => {
    delete reactionTimers[p.message_id];
    loadReactions(p.conversation_id, [p.message_id]);
  }, 400);
}

async function changeMessage(conversationId: string, messageId: string, change: (m: Message) => Message) {
  const current = getChatState().messages[conversationId]?.find((m) => m.id === messageId);
  if (!current) return;
  const next = change(current);
  putMessages(conversationId, [next]);
  await db?.saveMessages([next]);
}

function receiveDelete(p: ChangePayload) {
  changeMessage(p.conversation_id, p.message_id, (m) => ({ ...m, deleted: true, body: null, attachment: null, link: null, reply: null }));
  setChatState((s) => {
    const reactions = { ...s.reactions };
    delete reactions[p.message_id];
    return { reactions };
  });
  updateChat(p.conversation_id, (c) =>
    c.pinned?.id === p.message_id ? { ...c, pinned: null } : c,
  );
  refreshChats(); // the list's preview may now say the message was deleted
}

function receiveEdit(p: EditPayload) {
  changeMessage(p.conversation_id, p.message_id, (m) => ({ ...m, body: p.body, edited_at: p.edited_at, link: m.kind === 'text' ? null : m.link }));
}

async function loadReactionsUnsafe(conversationId: string, only?: string[]) {
  const ids = only ?? (getChatState().messages[conversationId] ?? []).filter((m) => m.status === 'sent' && !m.deleted).slice(0, 200).map((m) => m.id);
  if (ids.length === 0) return;
  const { data, error } = await supabase.rpc('reactions', { p_conversation_id: conversationId, p_message_ids: ids });
  if (error) return;
  const grouped: Record<string, Reaction[]> = {};
  for (const id of ids) grouped[id] = [];
  for (const r of data as { message_id: string; emoji: string; count: number; mine: boolean }[]) {
    grouped[r.message_id].push({ emoji: r.emoji, count: r.count, mine: r.mine });
  }
  // Unchanged reactions keep their old lists, so only bubbles whose reactions changed redraw; when
  // nothing changed (the usual case on opening a chat), nothing redraws at all.
  setChatState((s) => {
    const reactions = { ...s.reactions };
    let changed = false;
    for (const [id, list] of Object.entries(grouped)) {
      if (list.length) {
        if (!same(reactions[id], list)) {
          reactions[id] = list;
          changed = true;
        }
      } else if (reactions[id]) {
        delete reactions[id];
        changed = true;
      }
    }
    return changed ? { reactions } : {};
  });
}

/** Reacts with an emoji; the same emoji again (or null) takes the reaction back. */
export async function react(conversationId: string, messageId: string, emoji: string | null) {
  const before = getChatState().reactions[messageId] ?? [];
  const mineBefore = before.find((r) => r.mine)?.emoji ?? null;
  const next = emoji && emoji !== mineBefore ? emoji : null;
  // At once on screen: remove your old one, add the new one.
  let list = before
    .map((r) => (r.mine ? { ...r, count: r.count - 1, mine: false } : r))
    .filter((r) => r.count > 0);
  if (next) {
    const same = list.find((r) => r.emoji === next);
    list = same ? list.map((r) => (r.emoji === next ? { ...r, count: r.count + 1, mine: true } : r)) : [...list, { emoji: next, count: 1, mine: true }];
  }
  setChatState((s) => ({ reactions: { ...s.reactions, [messageId]: list } }));
  const { error } = await supabase.rpc('react', { p_conversation_id: conversationId, p_message_id: messageId, p_emoji: next as string });
  if (error) {
    setChatState((s) => ({ reactions: { ...s.reactions, [messageId]: before } }));
    return error.message;
  }
  return null;
}

/** Hides messages on all your devices. Ones that never reached the server just go. */
export async function deleteForMe(conversationId: string, messages: Message[]) {
  const sent = messages.filter((m) => m.status === 'sent');
  for (const m of sent) {
    const { error } = await supabase.rpc('delete_message', { p_conversation_id: conversationId, p_message_id: m.id, p_for_everyone: false });
    if (error) return error.message;
  }
  const ids = messages.map((m) => m.id);
  setChatState((s) =>
    s.messages[conversationId]
      ? { messages: { ...s.messages, [conversationId]: s.messages[conversationId].filter((m) => !ids.includes(m.id)) } }
      : {},
  );
  await db?.deleteMessages(ids);
  return null;
}

export async function deleteForEveryone(conversationId: string, message: Message) {
  const { error } = await supabase.rpc('delete_message', { p_conversation_id: conversationId, p_message_id: message.id, p_for_everyone: true });
  if (error) return error.message;
  receiveDelete({ conversation_id: conversationId, message_id: message.id });
  return null;
}

export async function editMessage(conversationId: string, message: Message, body: string) {
  const { data, error } = await supabase.rpc('edit_message', { p_conversation_id: conversationId, p_message_id: message.id, p_body: body });
  if (error) return error.message;
  receiveEdit({ conversation_id: conversationId, message_id: message.id, body: body.trim(), edited_at: data as string });
  if (getChatState().chats.find((c) => c.conversation_id === conversationId)?.last_message_at === message.created_at) refreshChats();
  return null;
}

async function loadStarredUnsafe() {
  const { data, error } = await supabase.rpc('starred_messages', { p_limit: 100 });
  if (error) return;
  const starred: Record<string, true> = {};
  for (const m of data as { id: string }[]) starred[m.id] = true;
  setChatState({ starred });
}

export async function starMessage(conversationId: string, message: Message, on: boolean) {
  setChatState((s) => {
    const starred = { ...s.starred };
    if (on) starred[message.id] = true;
    else delete starred[message.id];
    return { starred };
  });
  const { error } = await supabase.rpc('star_message', { p_conversation_id: conversationId, p_message_id: message.id, p_on: on });
  if (error) {
    loadStarred();
    return error.message;
  }
  return null;
}

export async function pinMessage(conversationId: string, message: Message | null) {
  const { data, error } = await supabase.rpc('pin_message', { p_conversation_id: conversationId, p_message_id: (message?.id ?? null) as string });
  if (error) return error.message;
  updateChat(conversationId, (c) => ({ ...c, pinned: (data as ReplySnapshot | null) ?? null }));
  return null;
}

/** Forwards messages to up to 5 chats. Each copy goes through the outbox like any message; the
 * server copies the original, so photos and documents are not uploaded again. */
export async function forwardMessages(messages: Message[], conversationIds: string[]) {
  if (!me || !db) return;
  const ordered = [...messages].filter((m) => m.status === 'sent' && !m.deleted).sort((a, b) => a.ts - b.ts);
  for (const target of conversationIds.slice(0, 5)) {
    for (const m of ordered) {
      const now = Date.now();
      await queue({
        ...m,
        id: uuidv7(),
        conversation_id: target,
        sender_id: me,
        sender_name: null,
        sender_avatar: null,
        reply_to_id: null,
        reply: null,
        mentions: null,
        forwarded: true,
        forward_from: m.id,
        created_at: new Date(now).toISOString(),
        ts: now,
        status: 'pending',
        error: null,
        edited_at: null,
      });
    }
  }
}

/** Messages in this chat containing the words (from the phone's copy). */
export async function searchMessages(conversationId: string, query: string) {
  return (await db?.search(conversationId, query)) ?? [];
}

/** Messages on this phone, in any chat, with every word of the query (the Chats tab search). */
export async function searchAllMessages(query: string, limit = 40) {
  return (await db?.search(null, query, limit)) ?? [];
}

/** Loads older messages until this one is on screen (for replies, pins, search and stars).
 * True when found. */
export async function loadUntil(conversationId: string, messageId: string) {
  for (let page = 0; page < 20; page++) {
    if (getChatState().messages[conversationId]?.some((m) => m.id === messageId)) return true;
    if (getChatState().hasOlder[conversationId] === false) return false;
    await loadOlder(conversationId);
  }
  return !!getChatState().messages[conversationId]?.some((m) => m.id === messageId);
}

/** Someone you have a direct chat with: online, or when last seen (null if hidden). */
export async function fetchPresence(userId: string) {
  const { data } = await supabase.rpc('presence', { p_user_id: userId });
  return (data as { online: boolean; last_seen_at: string } | null) ?? null;
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
export const prefetchConversation = safely('prefetch chat', prefetchConversationUnsafe);
export const loadOlder = safely('load older messages', loadOlderUnsafe);
export const sendMessage = safely('send', sendMessageUnsafe);
export const sendRich = safely('send', sendRichUnsafe);
const loadPolls = safely('load polls', loadPollsUnsafe);
const loadReactions = safely('load reactions', loadReactionsUnsafe);
const loadStarred = safely('load starred', loadStarredUnsafe);
export const retryMessage = safely('retry', retryMessageUnsafe);
const receive = safely('receive', receiveUnsafe);
const fetchNewer = safely('catch up', fetchNewerUnsafe);
const flushOutbox = safely('send waiting messages', flushOutboxUnsafe);
const connectInbox = safely('connect', connectInboxUnsafe);
