import { Text, View } from 'react-native';

import { ModuleDot } from '@/components/resources/module-dot';
import { PressableScale } from '@/components/ui/pressable-scale';
import { createThemedStyles, fonts, radius, space } from '@/theme/tokens';

type Props = {
  id: number;
  code: string;
  name: string;
  active: boolean;
  onPress: () => void;
  /** Outlined in the accent: the module the app suggests. */
  suggested?: boolean;
  disabled?: boolean;
  /** 'radio' in a picker (default); 'button' when tapping acts straight away. */
  role?: 'radio' | 'button';
};

// A module to choose: its colour, its name first (students know modules by name, not code), the code
// under it.
export function ModuleChip({ id, code, name, active, onPress, suggested = false, disabled = false, role = 'radio' }: Props) {
  const styles = useStyles();
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={role}
      accessibilityState={role === 'radio' ? { selected: active } : undefined}
      accessibilityLabel={`${name}, ${code}${suggested ? ', suggested' : ''}`}
      style={[styles.chip, suggested && styles.suggested, active && styles.active]}>
      <ModuleDot id={id} />
      <View style={styles.copy}>
        <Text style={[styles.name, active && styles.onAccent]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.code, active && styles.onAccent]} numberOfLines={1}>
          {code}
        </Text>
      </View>
    </PressableScale>
  );
}

const useStyles = createThemedStyles((t) => ({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    maxWidth: 240,
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: t.border,
    backgroundColor: t.surface,
  },
  copy: { flexShrink: 1 },
  suggested: { borderColor: t.accent },
  // Selected: the accent with Ink text (brand rule).
  active: { backgroundColor: t.accent, borderColor: t.accent },
  name: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 19, color: t.text },
  code: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16, color: t.textMuted },
  onAccent: { color: t.onAccent },
}));
