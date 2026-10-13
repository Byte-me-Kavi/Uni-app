import { Stack } from 'expo-router';

import { ChatProvider } from '@/providers/chat-provider';
import { HomeProvider } from '@/providers/home-provider';
import { PushProvider } from '@/providers/push-provider';
import { useTheme } from '@/theme/tokens';

// The tabs (with their persistent top bar and tab bar) sit at the bottom of this stack. Screens
// pushed on top, such as the account and batch screens, cover the tab bar. Home data is loaded
// once here so pushed screens can refresh it (e.g. after joining a batch). The chat engine runs
// for as long as the student is signed in, and push notifications open their chat when tapped.
export default function AppLayout() {
  const theme = useTheme();
  return (
    <HomeProvider>
      <ChatProvider>
        <PushProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              animation: 'slide_from_right',
              contentStyle: { backgroundColor: theme.background },
              // A covered screen (the tabs under an open chat) stops re-rendering until it shows
              // again, so live messages only redraw what you are looking at.
              freezeOnBlur: true,
            }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="profile" />
            <Stack.Screen name="batch" />
            <Stack.Screen name="people/[id]" />
            <Stack.Screen name="settings/about" />
            <Stack.Screen name="settings/find" />
            <Stack.Screen name="settings/message" />
            <Stack.Screen name="settings/blocked" />
            <Stack.Screen name="settings/notifications" />
            {/* One screen per chat: opening a chat that is already open goes back to it. */}
            <Stack.Screen name="chat/[id]" dangerouslySingular={(_name, params) => (params as { id?: string }).id} />
            <Stack.Screen name="group/[id]" />
            <Stack.Screen name="chat-files/[id]" />
            <Stack.Screen name="starred" />
            <Stack.Screen name="new-group" />
            <Stack.Screen name="settings/last-seen" />
            <Stack.Screen name="semester" />
            <Stack.Screen name="module/[id]" />
            <Stack.Screen name="to-sort" />
            <Stack.Screen name="share" />
            <Stack.Screen name="kuppi/[id]" />
            <Stack.Screen name="kuppi/new" />
            <Stack.Screen name="exams" />
            <Stack.Screen name="resource/[id]" />
            <Stack.Screen name="shop/[id]" />
            <Stack.Screen name="shop/new" />
            <Stack.Screen name="shop/mine" />
            <Stack.Screen name="shop/leads" />
            <Stack.Screen name="admin/ads" />
            <Stack.Screen name="admin/ad" />
            <Stack.Screen name="admin/posts" />
            <Stack.Screen name="post/[id]" />
            <Stack.Screen name="post/new" />
            <Stack.Screen name="shop/order/[id]" />
            <Stack.Screen name="shop/orders/[id]" />
          </Stack>
        </PushProvider>
      </ChatProvider>
    </HomeProvider>
  );
}
