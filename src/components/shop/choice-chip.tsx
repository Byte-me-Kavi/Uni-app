import { memo } from 'react';
import { Text } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { createThemedStyles, fonts, radius, space } from '@/theme/tokens';

// A choice on a shop form (a size, a category, a day). Selected: the accent with its own text colour.
export const ChoiceChip = memo(function ChoiceChip({
  label,
  active,
  onPress,
  multi = false,
  width,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  /** One of several that can be on at once (sizes). */
  multi?: boolean;
  /** A fixed width, for lists that open scrolled to the choice. */
  width?: number;
}) {
  const styles = useStyles();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={multi ? { checked: active } : { selected: active }}
      accessibilityLabel={label}
      style={[styles.chip, width ? { width, alignItems: 'center', paddingHorizontal: 0 } : null, active && styles.active]}>
      <Text style={[styles.text, active && styles.activeText]}>{label}</Text>
    </PressableScale>
  );
});

const useStyles = createThemedStyles((t) => ({
  chip: {
    paddingHorizontal: space.md + 2,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: t.border,
    backgroundColor: t.surface,
  },
  active: { backgroundColor: t.accent, borderColor: t.accent },
  text: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  activeText: { color: t.onAccent },
}));
