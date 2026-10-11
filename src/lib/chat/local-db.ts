import * as SQLite from 'expo-sqlite';

import type { Chat, Message } from '@/lib/chat/types';

// Chats and messages kept on the phone (like WhatsApp's message store), so the chat list and the
// newest messages show instantly, offline too. The server stays the source of truth; this is a
// cache plus the outbox of messages not yet sent. One database per account, so signing in as
// someone else on the same phone never shows the previous account's chats.

export type LocalDb = {
  loadChats(): Promise<Chat[]>;
  saveChats(chats: Chat[]): Promise<void>;
  /** Newest first. */
  loadMessages(conversationId: string, beforeTs?: number, limit?: number): Promise<Message[]>;
  saveMessages(messages: Message[]): Promise<void>;
  /** created_at of the newest message the server has confirmed: the cursor for catching up. */
  latestConfirmed(conversationId: string): Promise<string | null>;
  pendingMessages(): Promise<Message[]>;
  clearConversation(conversationId: string): Promise<void>;
  /** Keeps the newest messages of a group; direct chats are kept whole. */
  prune(conversationId: string, keep: number): Promise<void>;
  close(): Promise<void>;
};

type MessageRow = Omit<Message, 'deleted' | 'attachment'> & { deleted: number; attachment: string | null };
type ChatRow = Omit<Chat, 'muted'> & { muted: number };

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS chats (
  conversation_id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL, title TEXT, other_user_id TEXT, other_avatar_path TEXT,
  last_message_at TEXT, last_message_preview TEXT, last_sender_id TEXT, last_sender_name TEXT,
  unread INTEGER NOT NULL DEFAULT 0, muted INTEGER NOT NULL DEFAULT 0, request TEXT,
  member_count INTEGER NOT NULL DEFAULT 0, my_last_read_at TEXT, other_last_read_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL,
  sender_id TEXT, sender_name TEXT, sender_avatar TEXT,
  body TEXT, reply_to_id TEXT,
  created_at TEXT NOT NULL, ts INTEGER NOT NULL,
  status TEXT NOT NULL, error TEXT, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS messages_conversation_ts ON messages (conversation_id, ts DESC);
CREATE INDEX IF NOT EXISTS messages_pending ON messages (status) WHERE status = 'pending';
`;

const toMessage = (row: MessageRow): Message => ({
  ...row,
  kind: row.kind ?? 'text',
  deleted: row.deleted === 1,
  attachment: row.attachment ? (JSON.parse(row.attachment) as Message['attachment']) : null,
});

// Changes to the phone's tables, applied once each, in order (PRAGMA user_version counts them).
const UPGRADES = [
  // 1: photos, documents, stickers, polls and contacts
  `ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';
   ALTER TABLE messages ADD COLUMN attachment TEXT;`,
];
const toChat = (row: ChatRow): Chat => ({ ...row, muted: row.muted === 1 });

export async function openLocalDb(userId: string): Promise<LocalDb> {
  const db = await SQLite.openDatabaseAsync(`chats-${userId}.db`);
  // Wait up to 5 s for another connection to finish instead of failing with "database is locked"
  // (Fast Refresh in development can leave the previous connection open for a moment).
  await db.execAsync('PRAGMA busy_timeout = 5000;');
  await db.execAsync(SCHEMA);
  const version = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  for (let i = version; i < UPGRADES.length; i++) {
    await db.execAsync(`BEGIN; ${UPGRADES[i]} PRAGMA user_version = ${i + 1}; COMMIT;`);
  }

  // One connection, one operation at a time. Live messages, the outbox and screens all write at
  // once (your own message is saved by the outbox while its echo arrives over Realtime), and
  // SQLite allows one writer. expo-sqlite's exclusive transactions open a second connection each,
  // which is what collided ("database is locked"); a queue on this connection cannot. Every
  // operation takes a millisecond or two, so the queue never shows.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  // A transaction on this same connection. Safe because the queue lets nothing else run in between.
  async function transaction(task: () => Promise<void>) {
    await db.execAsync('BEGIN');
    try {
      await task();
      await db.execAsync('COMMIT');
    } catch (error) {
      await db.execAsync('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  return {
    loadChats: () =>
      serial(async () => (await db.getAllAsync<ChatRow>('SELECT * FROM chats')).map(toChat)),

    saveChats: (chats) =>
      serial(() =>
        transaction(async () => {
          await db.runAsync('DELETE FROM chats');
          const insert = await db.prepareAsync(
            `INSERT INTO chats VALUES ($conversation_id, $kind, $title, $other_user_id, $other_avatar_path, $last_message_at,
              $last_message_preview, $last_sender_id, $last_sender_name, $unread, $muted, $request, $member_count,
              $my_last_read_at, $other_last_read_at, $created_at)`,
          );
          try {
            for (const c of chats) {
              await insert.executeAsync({
                $conversation_id: c.conversation_id, $kind: c.kind, $title: c.title, $other_user_id: c.other_user_id,
                $other_avatar_path: c.other_avatar_path, $last_message_at: c.last_message_at,
                $last_message_preview: c.last_message_preview, $last_sender_id: c.last_sender_id,
                $last_sender_name: c.last_sender_name, $unread: c.unread, $muted: c.muted ? 1 : 0, $request: c.request,
                $member_count: c.member_count, $my_last_read_at: c.my_last_read_at, $other_last_read_at: c.other_last_read_at,
                $created_at: c.created_at,
              });
            }
          } finally {
            await insert.finalizeAsync();
          }
        }),
      ),

    loadMessages: (conversationId, beforeTs, limit = 50) =>
      serial(async () => {
        const rows = beforeTs
          ? await db.getAllAsync<MessageRow>(
              'SELECT * FROM messages WHERE conversation_id = ? AND ts < ? ORDER BY ts DESC, id DESC LIMIT ?',
              conversationId, beforeTs, limit)
          : await db.getAllAsync<MessageRow>(
              'SELECT * FROM messages WHERE conversation_id = ? ORDER BY ts DESC, id DESC LIMIT ?', conversationId, limit);
        return rows.map(toMessage);
      }),

    saveMessages: (messages) =>
      messages.length === 0
        ? Promise.resolve()
        : serial(() =>
            transaction(async () => {
              const upsert = await db.prepareAsync(
                `INSERT INTO messages (id, conversation_id, sender_id, sender_name, sender_avatar, body, reply_to_id,
                   created_at, ts, status, error, deleted, kind, attachment)
                 VALUES ($id, $conversation_id, $sender_id, $sender_name, $sender_avatar, $body, $reply_to_id,
                   $created_at, $ts, $status, $error, $deleted, $kind, $attachment)
                 ON CONFLICT(id) DO UPDATE SET sender_name = coalesce(excluded.sender_name, sender_name),
                   sender_avatar = coalesce(excluded.sender_avatar, sender_avatar),
                   body = excluded.body, created_at = excluded.created_at, ts = excluded.ts, status = excluded.status,
                   error = excluded.error, deleted = excluded.deleted, kind = excluded.kind,
                   attachment = excluded.attachment`,
              );
              try {
                for (const m of messages) {
                  await upsert.executeAsync({
                    $id: m.id, $conversation_id: m.conversation_id, $sender_id: m.sender_id, $sender_name: m.sender_name,
                    $sender_avatar: m.sender_avatar, $body: m.body, $reply_to_id: m.reply_to_id, $created_at: m.created_at,
                    $ts: m.ts, $status: m.status, $error: m.error, $deleted: m.deleted ? 1 : 0,
                    $kind: m.kind, $attachment: m.attachment ? JSON.stringify(m.attachment) : null,
                  });
                }
              } finally {
                await upsert.finalizeAsync();
              }
            }),
          ),

    latestConfirmed: (conversationId) =>
      serial(async () => {
        const row = await db.getFirstAsync<{ created_at: string }>(
          "SELECT created_at FROM messages WHERE conversation_id = ? AND status = 'sent' ORDER BY ts DESC LIMIT 1",
          conversationId);
        return row?.created_at ?? null;
      }),

    pendingMessages: () =>
      serial(async () =>
        (await db.getAllAsync<MessageRow>("SELECT * FROM messages WHERE status = 'pending' ORDER BY ts ASC")).map(toMessage),
      ),

    clearConversation: (conversationId) =>
      serial(async () => {
        await db.runAsync("DELETE FROM messages WHERE conversation_id = ? AND status = 'sent'", conversationId);
      }),

    prune: (conversationId, keep) =>
      serial(async () => {
        await db.runAsync(
          `DELETE FROM messages WHERE conversation_id = ? AND status = 'sent' AND id NOT IN
             (SELECT id FROM messages WHERE conversation_id = ? ORDER BY ts DESC LIMIT ?)`,
          conversationId, conversationId, keep);
      }),

    // Waits for queued work, then closes.
    close: () => serial(() => db.closeAsync()),
  };
}
