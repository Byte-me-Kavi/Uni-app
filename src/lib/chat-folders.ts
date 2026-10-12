import { useSyncExternalStore } from 'react';

import { supabase } from '@/lib/supabase';
import type { Category } from '@/lib/library';

// Where each file, photo and link in a chat is filed for this student (api.chat_folders), for the
// small folder tag under the bubble. Each bubble subscribes to its own message only, so a new
// answer redraws just the bubbles it is about.

export type Folder = { module_id?: number; code?: string; category?: Category; blocked?: boolean; reason?: string };

const folders = new Map<string, Folder | null>();
const listeners = new Map<string, Set<() => void>>();
const asked = new Set<string>();
let pressHandler: ((messageId: string) => void) | null = null;

function emit(id: string) {
  listeners.get(id)?.forEach((l) => l());
}

/** Looks up the folders of a chat's messages not asked about yet (up to 200 at a time). */
export async function loadFolders(conversationId: string, messageIds: string[], force = false) {
  const ids = messageIds.filter((id) => force || !asked.has(id)).slice(0, 200);
  if (ids.length === 0) return;
  ids.forEach((id) => asked.add(id));
  const { data, error } = await supabase.rpc('chat_folders', { p_conversation_id: conversationId, p_message_ids: ids });
  if (error) {
    ids.forEach((id) => asked.delete(id));
    return;
  }
  const found = new Map(((data ?? []) as (Folder & { message_id: string })[]).map((f) => [f.message_id, f]));
  for (const id of ids) {
    const next = found.get(id) ?? null;
    const before = folders.get(id);
    folders.set(id, next);
    if (JSON.stringify(before ?? null) !== JSON.stringify(next)) emit(id);
  }
}

export function useFolder(messageId: string) {
  return useSyncExternalStore(
    (listener) => {
      const set = listeners.get(messageId) ?? new Set();
      set.add(listener);
      listeners.set(messageId, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(messageId);
      };
    },
    () => folders.get(messageId) ?? null,
  );
}

/** The open chat screen handles taps on folder tags (it opens Save to Resources). */
export function onFolderPress(handler: ((messageId: string) => void) | null) {
  pressHandler = handler;
}

export function pressFolder(messageId: string) {
  pressHandler?.(messageId);
}

/** The sender chooses a module while sending; recorded even before the message reaches the server. */
export async function tagMessage(conversationId: string, messageId: string, moduleId: number) {
  const { error } = await supabase.rpc('tag_message', { p_conversation_id: conversationId, p_message_id: messageId, p_module_id: moduleId });
  if (!error) {
    asked.delete(messageId);
    await loadFolders(conversationId, [messageId]);
  }
  return error?.message ?? null;
}
