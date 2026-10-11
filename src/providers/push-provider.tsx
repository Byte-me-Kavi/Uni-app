import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, type ReactNode } from 'react';

import { useChatState, useUnreadTotal } from '@/lib/chat/store';
import { conversationOf, pushSupported, registerPush, setAppBadge } from '@/lib/push';
import { useSession } from '@/providers/session-provider';

// Keeps this phone registered for the signed-in student (if they turned notifications on) and
// opens the chat when a notification is tapped, including one that launched the app.
export function PushProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const userId = session.status === 'signed_in' ? session.session.user.id : null;
  const unread = useUnreadTotal();
  const chatsKnown = useChatState((s) => s.chatsLoaded || s.chats.length > 0);

  // The app icon follows the Chats tab count while the app runs (once the chats are known, so a
  // cold start does not briefly clear it).
  useEffect(() => {
    if (chatsKnown) setAppBadge(unread);
  }, [unread, chatsKnown]);

  useEffect(() => {
    if (!userId || !pushSupported) return;
    registerPush().catch((error) => console.warn('[push] could not register', error));
    // Expo can rotate the token (reinstall, restored backup); register the new one.
    const tokenSub = Notifications.addPushTokenListener(() => {
      registerPush().catch((error) => console.warn('[push] could not register', error));
    });
    return () => tokenSub.remove();
  }, [userId]);

  useEffect(() => {
    if (!userId || !pushSupported) return;
    const open = (response: Notifications.NotificationResponse | null) => {
      const id = conversationOf(response);
      if (!id) return;
      router.push({ pathname: '/chat/[id]', params: { id } });
      Notifications.clearLastNotificationResponse();
    };
    open(Notifications.getLastNotificationResponse()); // the tap that opened the app
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [userId]);

  return children;
}
