import { router } from 'expo-router';

import { holdStickerImport } from '@/lib/chat/sticker-library';

// Opens a chat screen. A second tap while the first is still opening (a slow phone, a double
// tap) is ignored, so one tap always means one chat screen and one press of back.
const QUIET_MS = 900;
let last = { id: '', at: 0 };

export function openChat(id: string, jump?: string) {
  const now = Date.now();
  if (now - last.at < QUIET_MS) return;
  last = { id, at: now };
  holdStickerImport(); // a running sticker import waits until the chat is open
  router.push({ pathname: '/chat/[id]', params: jump ? { id, jump } : { id } });
}
