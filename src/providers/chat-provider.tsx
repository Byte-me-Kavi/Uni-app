import { useEffect, type ReactNode } from 'react';

import { startChat, stopChat } from '@/lib/chat/engine';
import { warmSignedUrls } from '@/lib/chat/media-urls';
import { importFromWhatsApp, loadStickers, resetStickers } from '@/lib/chat/sticker-library';
import { useSession } from '@/providers/session-provider';

// Starts the chat engine for the signed-in student (their phone database, the live connection,
// the outbox) and stops it on sign-out, so the next account never sees the previous one's chats.
export function ChatProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const userId = session.status === 'signed_in' ? session.session.user.id : null;

  useEffect(() => {
    if (!userId) return;
    startChat(userId);
    warmSignedUrls();
    // Your stickers, and any new ones from WhatsApp (at most once a day, if you linked it).
    loadStickers(userId)
      .then(() => importFromWhatsApp())
      .catch(() => {});
    return () => {
      stopChat();
      resetStickers();
    };
  }, [userId]);

  return children;
}
