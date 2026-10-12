import { memo } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';

import { UniEraMark } from '@/components/brand/uni-era-mark';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Props = { assemble: boolean; /** In the ads carousel: as tall as an ad, so slides line up. */ minHeight?: number };

// The one bold surface on the home screen: the theme's accent with the tagline in Figtree Black and the
// mark beside it, centred vertically and fully visible. Text and mark take the theme's colour on the
// accent (Ink on pale accents, white on deep ones); the tassel takes the other one (logo system rule).
export const BrandCard = memo(function BrandCard({ assemble, minHeight }: Props) {
  const theme = useTheme();
  const styles = useStyles();
  const tassel = theme.onAccent === brand.ink ? brand.white : brand.ink;
  // Narrow phones (under ~380pt) get a smaller mark and headline so the headline keeps its two lines.
  const narrow = useWindowDimensions().width < 380;
  return (
    <View style={[styles.card, minHeight ? { minHeight } : null]}>
      <View style={styles.copy}>
        <Text style={[styles.headline, narrow && styles.headlineNarrow]}>{"you're in your\nuni era."}</Text>
        <Text style={styles.body}>Notes, kuppi, chats and events with students from every university.</Text>
      </View>
      <View style={styles.mark} pointerEvents="none" importantForAccessibility="no-hide-descendants">
        <UniEraMark
          size={narrow ? 84 : 104}
          color={theme.onAccent}
          tasselColor={tassel}
          motion={assemble ? 'assemble' : undefined}
        />
      </View>
    </View>
  );
});

const useStyles = createThemedStyles((t) => ({
  card: {
    backgroundColor: t.accent,
    borderRadius: radius.lg + 6,
    padding: space.xl,
    minHeight: 172,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  // Text takes the remaining width; the mark keeps its size, so they never overlap.
  copy: { flex: 1, gap: space.sm },
  headline: { fontFamily: fonts.wordmark, fontSize: 27, lineHeight: 30, letterSpacing: -0.5, color: t.onAccent },
  headlineNarrow: { fontSize: 23, lineHeight: 26 },
  body: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 21, color: t.onAccent },
  mark: { flexShrink: 0 },
}));
