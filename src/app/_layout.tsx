import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useFonts, type FontSource } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { SessionProvider, useSession } from '@/providers/session-provider';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();

// Release and development builds embed the fonts natively (expo-font config plugin in app.json), so
// they are ready at launch with no loading step. Expo Go cannot embed fonts, so only there do we
// load them at runtime.
const runtimeFonts: Record<string, FontSource> =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient
    ? {
        'Unbounded-ExtraBold': require('../../assets/fonts/Unbounded-ExtraBold.ttf'),
        'Figtree-Regular': require('../../assets/fonts/Figtree-Regular.ttf'),
        'Figtree-SemiBold': require('../../assets/fonts/Figtree-SemiBold.ttf'),
        'Figtree-Bold': require('../../assets/fonts/Figtree-Bold.ttf'),
      }
    : {};

export default function RootLayout() {
  return (
    <SessionProvider>
      <RootNavigator />
    </SessionProvider>
  );
}

function RootNavigator() {
  const session = useSession();
  const [fontsLoaded, fontError] = useFonts(runtimeFonts);
  const ready = session.status !== 'loading' && (fontsLoaded || fontError !== null);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  const signedIn = session.status === 'signed_in';
  const active = signedIn && session.claims.accountStatus === 'active';

  // Client-side guards only decide which screens to show. Data access is enforced by the database.
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: colors.ink },
        }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !active}>
          <Stack.Screen name="account-status" />
        </Stack.Protected>
        <Stack.Protected guard={active}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
