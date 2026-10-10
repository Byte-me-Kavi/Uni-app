import { Text, View, useWindowDimensions } from 'react-native';

import { UniEraMark } from '@/components/brand/uni-era-mark';
import { brand, createThemedStyles, fonts, radius, space } from '@/theme/tokens';

type Props = { assemble: boolean };

// The one bold surface on the home screen: brand red with the tagline in Figtree Black and the
// mark beside it, centred vertically and fully visible. On red the tassel turns white (logo system
// rule). Text on red is Ink, never white.
export function BrandCard({ assemble }: Props) {
  const styles = useStyles();
  // Narrow phones (under ~380pt) get a smaller mark and headline so the headline keeps its two lines.
  const narrow = useWindowDimensions().width < 380;
  return (
    <View style={styles.card}>
      <View style={styles.copy}>
        <Text style={[styles.headline, narrow && styles.headlineNarrow]}>{"you're in your\nuni era."}</Text>
        <Text style={styles.body}>Notes, kuppi, chats and events with students from every university.</Text>
      </View>
      <View style={styles.mark} pointerEvents="none" importantForAccessibility="no-hide-descendants">
        <UniEraMark size={narrow ? 84 : 104} color={brand.ink} tasselColor={brand.white} motion={assemble ? 'assemble' : undefined} />
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  // Text takes the remaining width; the mark keeps its size, so they never overlap.
  copy: { flex: 1, gap: space.sm },
  headline: { fontFamily: fonts.wordmark, fontSize: 27, lineHeight: 30, color: brand.ink, letterSpacing: -0.5 },
  headlineNarrow: { fontSize: 23, lineHeight: 26 },
  body: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 21, color: brand.ink },
  mark: { flexShrink: 0 },
}));
