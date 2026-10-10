import { Stack } from 'expo-router';

import { useTheme } from '@/theme/tokens';

export default function AppLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: theme.background },
      }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="profile" />
    </Stack>
  );
}
