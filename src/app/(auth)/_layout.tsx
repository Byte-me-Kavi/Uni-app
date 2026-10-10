import { Stack, ThemeProvider, useTheme as useNavigationTheme } from 'expo-router';

import { AuthChrome } from '@/components/auth/auth-chrome';

// AuthChrome (background, safe area, logo, corner mark) wraps the stack and stays mounted. The
// navigator and the screens inside are transparent, so a switch between sign-in, sign-up and
// verify crossfades only the form; the logo and mark never fade out, and the mark shows through
// behind the form.
export default function AuthLayout() {
  const navigationTheme = useNavigationTheme();
  const transparent = {
    ...navigationTheme,
    colors: { ...navigationTheme.colors, background: 'transparent', card: 'transparent' },
  };

  return (
    <AuthChrome>
      <ThemeProvider value={transparent}>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'fade',
            animationDuration: 200,
            contentStyle: { backgroundColor: 'transparent' },
          }}>
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="sign-up" />
          <Stack.Screen name="verify-email" />
        </Stack>
      </ThemeProvider>
    </AuthChrome>
  );
}
