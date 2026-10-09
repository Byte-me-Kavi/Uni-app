import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors, fonts, radius, space } from '@/theme/tokens';

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'quiet';
  loading?: boolean;
  disabled?: boolean;
};

export function Button({ label, onPress, variant = 'primary', loading = false, disabled = false }: Props) {
  const inactive = disabled || loading;
  const primary = variant === 'primary';

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        primary ? styles.primary : styles.quiet,
        pressed && !inactive && styles.pressed,
        inactive && styles.inactive,
      ]}>
      {loading ? (
        <ActivityIndicator color={primary ? colors.ink : colors.white} />
      ) : (
        <Text style={[styles.label, { color: primary ? colors.ink : colors.white }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  // Text on red is always Ink (brand rule).
  primary: { backgroundColor: colors.red },
  quiet: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.inkBorder },
  pressed: { opacity: 0.85 },
  inactive: { opacity: 0.5 },
  label: { fontFamily: fonts.bodyBold, fontSize: 16 },
});
