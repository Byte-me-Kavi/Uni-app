import { useSyncExternalStore } from 'react';

import type { Chat, Message } from '@/lib/chat/types';

// What the chat screens draw from. Kept in memory and filled from the phone's database first,
// then from the server. Screens subscribe to the slice they need, so a new message in one chat
// re-renders that chat, the list row and the tab badge, nothing else.
export type ChatState = {
  me: string | null;
  chats: Chat[];
  chatsLoaded: boolean;
  /** Newest first, per conversation, for the chats that have been opened. */
  messages: Record<string, Message[]>;
  /** Whether older messages may exist beyond what is loaded. */
  hasOlder: Record<string, boolean>;
  /** Until when (ms) the other student in a direct chat is shown as typing. */
  typingUntil: Record<string, number>;
  /** The live connection: connecting, live, or offline (messages then wait in the outbox). */
  connection: 'connecting' | 'live' | 'offline';
};

const initial: ChatState = {
  me: null,
  chats: [],
  chatsLoaded: false,
  messages: {},
  hasOlder: {},
  typingUntil: {},
  connection: 'connecting',
};

let state = initial;
const listeners = new Set<() => void>();

export function getChatState() {
  return state;
}

export function setChatState(update: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) {
  const patch = typeof update === 'function' ? update(state) : update;
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function resetChatState() {
  state = initial;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders only when the selected value changes (by reference). */
export function useChatState<T>(select: (s: ChatState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state), () => select(state));
}

const EMPTY: Message[] = [];
export function useMessages(conversationId: string) {
  return useChatState((s) => s.messages[conversationId] ?? EMPTY);
}

export function useChat(conversationId: string) {
  return useChatState((s) => s.chats.find((c) => c.conversation_id === conversationId) ?? null);
}

/** Unread across accepted, unmuted chats, plus incoming requests: the Chats tab badge. */
export function useUnreadTotal() {
  return useChatState((s) =>
    s.chats.reduce((sum, c) => sum + (c.request === 'incoming' ? 1 : c.muted || c.request ? 0 : c.unread), 0),
  );
}
