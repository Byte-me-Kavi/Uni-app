import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius, space } from '@/theme/tokens';

type Props = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export function CheckRow({ label, checked, onChange }: Props) {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      hitSlop={6}
      style={styles.row}>
      <View style={[styles.box, checked && styles.boxChecked]}>
        {checked ? <Text style={styles.tick}>{'✓'}</Text> : null}
      </View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.sm / 2,
    borderWidth: 1.5,
    borderColor: colors.onInkMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: colors.red, borderColor: colors.red },
  tick: { color: colors.ink, fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 18 },
  label: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.white },
});
