import { StyleSheet, Text, View } from 'react-native';

import { UniEraMark } from '@/components/brand/uni-era-mark';
import { brand, fonts, useTheme } from '@/theme/tokens';

type Props = {
  /** Width of the mark in points; the wordmark scales with it. */
  size?: number;
  /** Mark and wordmark colour. Defaults to the theme's text colour (ink on light, white on dark). */
  color?: string;
};

// Horizontal lockup from the logo system: the mark, then "uni era" in Figtree Black.
// The tassel stays red on light and dark; only on a red background does it turn white.
export function Lockup({ size = 32, color }: Props) {
  const theme = useTheme();
  const ink = color ?? theme.text;
  return (
    <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel="uni era">
      <UniEraMark size={size} color={ink} tasselColor={brand.red} />
      <Text
        style={[
          styles.word,
          { fontSize: size * 0.92, lineHeight: Math.round(size * 1.15), color: ink, marginLeft: size * 0.32 },
        ]}>
        uni era
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  word: { fontFamily: fonts.wordmark, letterSpacing: -0.6, includeFontPadding: false, marginTop: 2 },
});
