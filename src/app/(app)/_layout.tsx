import { Stack } from 'expo-router';

import { HomeProvider } from '@/providers/home-provider';
import { useTheme } from '@/theme/tokens';

// The tabs (with their persistent top bar and tab bar) sit at the bottom of this stack. Screens
// pushed on top, such as the account and batch screens, cover the tab bar. Home data is loaded
// once here so pushed screens can refresh it (e.g. after joining a batch).
export default function AppLayout() {
  const theme = useTheme();
  return (
    <HomeProvider>
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
      </Stack>
    </HomeProvider>
  );
}
