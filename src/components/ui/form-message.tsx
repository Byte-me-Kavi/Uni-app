import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius, space } from '@/theme/tokens';

type Props = { message: string | null; tone?: 'error' | 'info' };

export function FormMessage({ message, tone = 'error' }: Props) {
  if (!message) return null;
  const error = tone === 'error';
  return (
    <View
      style={[styles.box, error ? styles.error : styles.info]}
      accessibilityRole={error ? 'alert' : 'text'}
      accessibilityLiveRegion="assertive">
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, padding: space.lg },
  // Red tint with Ink text: the brand's soft highlight, readable at 4.5:1.
  error: { backgroundColor: colors.redTint },
  info: { backgroundColor: colors.smoke },
  text: { fontFamily: fonts.bodySemiBold, fontSize: 14, lineHeight: 20, color: colors.ink },
});
