import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { UniEraMark } from '@/components/brand/uni-era-mark';
import { BrandCard } from '@/components/home/brand-card';
import { HomeSkeleton } from '@/components/home/home-skeleton';
import { QuietFeed } from '@/components/home/quiet-feed';
import { SetupList, type SetupStep } from '@/components/home/setup-list';
import { StaffCard } from '@/components/home/staff-card';
import { EntranceContext, Reveal } from '@/components/motion/reveal';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { firstName, useHome, type MyHome } from '@/lib/use-home';
import { brand, createThemedStyles, fonts, space, useTheme } from '@/theme/tokens';

// The home entrance (content rising in, the cap dropping onto the u in the brand card) plays once
// per launch. Coming back to home later shows it instantly.
let homeIntroPlayed = false;

export default function Home() {
  const theme = useTheme();
  const styles = useStyles();
  const { state, refreshing, refresh, retry } = useHome();
  const [entrance] = useState(() => {
    const play = !homeIntroPlayed;
    homeIntroPlayed = true;
    return play;
  });

  const home = state.status === 'ready' ? state.home : null;

  return (
    <EntranceContext value={entrance}>
      <Screen style={styles.safe} edges={['top']}>
        <View style={styles.topBar}>
          <UniEraMark size={30} color={theme.text} tasselColor={brand.red} />
          {home ? (
            <PressableScale
              onPress={() => router.push('/profile')}
              accessibilityRole="button"
              accessibilityLabel="Your account"
              hitSlop={8}>
              <Avatar name={home.full_name} />
            </PressableScale>
          ) : null}
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={brand.red}
              colors={[brand.red]}
              progressBackgroundColor={theme.surface}
            />
          }>
          {state.status === 'loading' ? <HomeSkeleton /> : null}
          {state.status === 'error' ? (
            <View style={styles.error}>
              <FormMessage message="Could not load your home. Check your connection and try again." />
              <Button label="Try again" variant="quiet" onPress={retry} />
            </View>
          ) : null}
          {home ? <HomeContent home={home} entrance={entrance} /> : null}
        </ScrollView>
      </Screen>
    </EntranceContext>
  );
}

function HomeContent({ home, entrance }: { home: MyHome; entrance: boolean }) {
  const styles = useStyles();

  // Real account state only. Steps that are not built yet say so instead of linking nowhere.
  const steps: SetupStep[] = [
    { key: 'email', label: 'Confirm your university email', done: true },
    { key: 'approved', label: 'Get approved by a moderator', done: home.account_status === 'active' },
    { key: 'batch', label: 'Find your batch', done: home.has_cohort, comingSoon: true },
    { key: 'modules', label: 'Add your modules', done: home.module_count > 0, comingSoon: true },
  ];

  return (
    <View style={styles.stack}>
      <Reveal order={0}>
        <Text style={styles.greeting} accessibilityRole="header">
          Hi, {firstName(home.full_name)}
        </Text>
        <Text style={styles.institution}>{home.institution.name}</Text>
      </Reveal>

      <Reveal order={1}>
        <BrandCard assemble={entrance} />
      </Reveal>

      {home.staff_role && home.pending_accounts !== null ? (
        <Reveal order={2}>
          <StaffCard count={home.pending_accounts} role={home.staff_role} />
        </Reveal>
      ) : null}

      <Reveal order={3}>
        <SetupList steps={steps} />
      </Reveal>

      <Reveal order={4}>
        <QuietFeed hasCohort={home.has_cohort} />
      </Reveal>
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  safe: { flex: 1, backgroundColor: t.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.md,
    minHeight: 56,
  },
  content: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.xxxl },
  stack: { gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  greeting: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, color: t.text, letterSpacing: -0.3 },
  institution: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 21, color: t.textMuted, marginTop: 2 },
  error: { gap: space.lg },
}));
