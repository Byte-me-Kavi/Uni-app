import type { LocalDb } from '@/lib/chat/local-db';
import type { Chat, Message } from '@/lib/chat/types';

export type { LocalDb } from '@/lib/chat/local-db';

// Web keeps chats in memory for the session; the phone apps keep them in SQLite. (expo-sqlite's
// web build needs cross-origin isolation headers, which the hosting would have to send.)
export async function openLocalDb(_userId: string): Promise<LocalDb> {
  let chats: Chat[] = [];
  const messages = new Map<string, Message>();
  const byConversation = (id: string) =>
    [...messages.values()].filter((m) => m.conversation_id === id).sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : -1));

  return {
    async loadChats() {
      return chats;
    },
    async saveChats(next) {
      chats = next;
    },
    async loadMessages(conversationId, beforeTs, limit = 50) {
      return byConversation(conversationId).filter((m) => !beforeTs || m.ts < beforeTs).slice(0, limit);
    },
    async saveMessages(next) {
      for (const m of next) messages.set(m.id, m);
    },
    async latestConfirmed(conversationId) {
      return byConversation(conversationId).find((m) => m.status === 'sent')?.created_at ?? null;
    },
    async pendingMessages() {
      return [...messages.values()].filter((m) => m.status === 'pending').sort((a, b) => a.ts - b.ts);
    },
    async clearConversation(conversationId) {
      for (const m of byConversation(conversationId)) if (m.status === 'sent') messages.delete(m.id);
    },
    async deleteMessages(ids) {
      for (const id of ids) messages.delete(id);
    },
    async search(conversationId, query, limit = 50) {
      const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (words.length === 0) return [];
      return byConversation(conversationId)
        .filter((m) => !m.deleted && words.every((w) => (m.body ?? '').toLowerCase().includes(w)))
        .slice(0, limit);
    },
    async prune(conversationId, keep) {
      byConversation(conversationId).slice(keep).forEach((m) => m.status === 'sent' && messages.delete(m.id));
    },
    async close() {
      messages.clear();
      chats = [];
    },
  };
}
