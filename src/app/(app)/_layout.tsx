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
            <Stack.Screen name="chat/[id]" />
            <Stack.Screen name="group/[id]" />
          </Stack>
        </PushProvider>
      </ChatProvider>
    </HomeProvider>
  );
}
