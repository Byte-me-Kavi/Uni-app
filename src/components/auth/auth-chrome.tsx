import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { Lockup } from '@/components/brand/lockup';
import { UniEraMark } from '@/components/brand/uni-era-mark';
import { Screen } from '@/components/ui/screen';
import { brand, createThemedStyles, space, useTheme } from '@/theme/tokens';

type Props = {
  children: ReactNode;
  /** The tassel sways slowly: the account is waiting on someone else. */
  waiting?: boolean;
};

const HERO = 180;

// The cap drops onto the u once per app launch.
let assembled = false;

// The parts of the auth screens that never change: background, safe area, the large corner mark
// and the lockup. It wraps the auth stack in (auth)/_layout.tsx, so it stays mounted while
// sign-in, sign-up and verify swap underneath it. Only the form area transitions; the logo never
// leaves the screen. (When each screen drew its own logo, every switch faded the whole screen,
// logo included, out and back in.)
export function AuthChrome({ children, waiting = false }: Props) {
  const theme = useTheme();
  const styles = useStyles();
  const [assemble] = useState(() => {
    const play = !assembled;
    assembled = true;
    return play;
  });

  return (
    <Screen style={styles.screen}>
      {/* A large, quiet mark in the corner, behind the form. Only the tassel is in colour: it is
          the one red thing in the brand. Decorative, so hidden from screen readers; the lockup
          carries the name. */}
      <View style={styles.hero} pointerEvents="none" importantForAccessibility="no-hide-descendants">
        <UniEraMark
          size={HERO}
          color={theme.heroMark}
          tasselColor={brand.red}
          motion={waiting ? 'waiting' : assemble ? 'assemble' : undefined}
        />
      </View>
      <View style={styles.header}>
        <Lockup size={30} />
      </View>
      <View style={styles.body}>{children}</View>
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  // Top-right, fully on screen so the whole cap and tassel are visible as it lands.
  hero: { position: 'absolute', top: space.md, right: space.lg },
  header: { paddingHorizontal: space.xl, paddingTop: space.xl },
  body: { flex: 1 },
}));
