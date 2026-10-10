import { useEffect, type ReactNode } from 'react';

import { startChat, stopChat } from '@/lib/chat/engine';
import { useSession } from '@/providers/session-provider';

// Starts the chat engine for the signed-in student (their phone database, the live connection,
// the outbox) and stops it on sign-out, so the next account never sees the previous one's chats.
export function ChatProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const userId = session.status === 'signed_in' ? session.session.user.id : null;

  useEffect(() => {
    if (!userId) return;
    startChat(userId);
    return () => {
      stopChat();
    };
  }, [userId]);

  return children;
}
