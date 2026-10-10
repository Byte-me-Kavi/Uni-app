import { Text, View } from 'react-native';

import { UniEraMark } from '@/components/brand/uni-era-mark';
import { brand, createThemedStyles, fonts, radius, space } from '@/theme/tokens';

type Props = { assemble: boolean };

// The one bold surface on the home screen: brand red with the tagline in Figtree Black and the
// mark bleeding off the bottom edge. On red the tassel turns white (logo system rule). Text on red is
// Ink, never white.
export function BrandCard({ assemble }: Props) {
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <View style={styles.copy}>
        <Text style={styles.headline}>{"you're in your\nuni era."}</Text>
        <Text style={styles.body}>Notes, kuppi, chats and events for your batch, all in one place.</Text>
      </View>
      <View style={styles.mark} pointerEvents="none" importantForAccessibility="no-hide-descendants">
        <UniEraMark size={116} color={brand.ink} tasselColor={brand.white} motion={assemble ? 'assemble' : undefined} />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles(() => ({
  card: {
    backgroundColor: brand.red,
    borderRadius: radius.lg + 6,
    padding: space.xl,
    minHeight: 172,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  // Copy column and mark are sized to stay clear of each other on 360pt-wide phones.
  copy: { gap: space.sm, maxWidth: '58%' },
  headline: { fontFamily: fonts.wordmark, fontSize: 27, lineHeight: 30, color: brand.ink, letterSpacing: -0.5 },
  body: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 21, color: brand.ink },
  // Bleeds off the bottom edge only, so the tassel (the one accent) is always fully visible.
  mark: { position: 'absolute', right: space.lg, bottom: -38 },
}));
