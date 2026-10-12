import type { NotificationResponse } from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, type ReactNode } from 'react';

import { sendMessage, whenChatReady } from '@/lib/chat/engine';
import { openChat } from '@/lib/chat/open-chat';
import { useChatState, useUnreadTotal } from '@/lib/chat/store';
import { supabase } from '@/lib/supabase';
import { Notifications, conversationOf, hrefOf, kuppiOf, pushSupported, registerPush, setAppBadge, shopOf } from '@/lib/push';
import { useSession } from '@/providers/session-provider';

// Keeps this phone registered for the signed-in student (if they turned notifications on) and
// opens the chat (or the kuppi, the shop listing, or its orders for a rep) when a notification is tapped,
// including one that launched the app.
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
    const open = async (response: NotificationResponse | null) => {
      // Kuppi, exams, the shop, shared files and account news carry the screen to open.
      const href = hrefOf(response);
      if (href) {
        Notifications.clearLastNotificationResponse();
        if (href !== '/') router.push(href as Parameters<typeof router.push>[0]);
        return;
      }
      const kuppi = kuppiOf(response);
      if (kuppi) {
        Notifications.clearLastNotificationResponse();
        router.push({ pathname: '/kuppi/[id]', params: { id: kuppi } });
        return;
      }
      const shop = shopOf(response);
      if (shop) {
        Notifications.clearLastNotificationResponse();
        router.push(
          shop.order
            ? { pathname: '/shop/orders/[id]', params: { id: shop.listingId } }
            : { pathname: '/shop/[id]', params: { id: shop.listingId } },
        );
        return;
      }
      const id = conversationOf(response);
      if (!id || !response) return;
      Notifications.clearLastNotificationResponse();
      const notification = response.notification.request.identifier;
      // Reply typed in the notification: sent through the outbox like any message.
      if (response.actionIdentifier === 'reply') {
        const text = response.userText?.trim();
        if (text && (await whenChatReady())) sendMessage(id, text);
        Notifications.dismissNotificationAsync(notification).catch(() => {});
        return;
      }
      if (response.actionIdentifier === 'read') {
        await supabase.rpc('mark_read', { p_conversation_id: id, p_up_to: new Date().toISOString() });
        Notifications.dismissNotificationAsync(notification).catch(() => {});
        return;
      }
      openChat(id);
    };
    open(Notifications.getLastNotificationResponse()); // the tap that opened the app
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [userId]);

  return children;
}
