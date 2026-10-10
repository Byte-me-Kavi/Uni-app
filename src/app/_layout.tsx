import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useFonts, type FontSource } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { Platform, useColorScheme } from 'react-native';

import { SessionProvider, useSession } from '@/providers/session-provider';
import { brand, useTheme } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();

// Release and development builds embed the fonts natively (expo-font config plugin in app.json), so
// they are ready at launch with no loading step. Expo Go cannot embed fonts and config plugins do not
// run on web, so only those load them at runtime.
const needsRuntimeFonts =
  Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const runtimeFonts: Record<string, FontSource> = needsRuntimeFonts
  ? {
      'Figtree-Black': require('../../assets/fonts/Figtree-Black.ttf'),
      'Nunito-Regular': require('../../assets/fonts/Nunito-Regular.ttf'),
      'Nunito-SemiBold': require('../../assets/fonts/Nunito-SemiBold.ttf'),
      'Nunito-Bold': require('../../assets/fonts/Nunito-Bold.ttf'),
      'Nunito-ExtraBold': require('../../assets/fonts/Nunito-ExtraBold.ttf'),
    }
  : {};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(runtimeFonts);

  // Nothing may render before the fonts exist. Text measured with the fallback font keeps that
  // narrower width after the real font arrives, which clips the last letters on native.
  if (!fontsLoaded && !fontError) return null;

  return (
    <SessionProvider>
      <RootNavigator />
    </SessionProvider>
  );
}

function RootNavigator() {
  const session = useSession();
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const ready = session.status !== 'loading';

  // Two backgrounds sit behind every screen: the native root view and the navigator. Both default
  // to white. During a crossfade both screens are partly transparent, so in dark mode that white
  // showed through as a flash. Keep both on the theme background.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.background);
  }, [theme.background]);

  const base = dark ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: brand.red,
      background: theme.background,
      card: theme.background,
      text: theme.text,
      border: theme.border,
    },
  };

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  const signedIn = session.status === 'signed_in';
  const active = signedIn && session.claims.accountStatus === 'active';
  const named = active && session.claims.nameConfirmed;

  // Client-side guards only decide which screens to show. Data access is enforced by the database.
  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style={theme.statusBar} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: theme.background },
        }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !active}>
          <Stack.Screen name="account-status" />
        </Stack.Protected>
        <Stack.Protected guard={active && !named}>
          <Stack.Screen name="welcome" />
        </Stack.Protected>
        <Stack.Protected guard={named}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
