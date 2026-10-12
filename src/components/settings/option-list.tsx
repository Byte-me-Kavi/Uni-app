import { Text, View } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { createThemedStyles, fonts, radius, space } from '@/theme/tokens';

type Option<T extends string> = { value: T; label: string; detail: string };

type Props<T extends string> = {
  options: Option<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  disabled?: boolean;
};

// A single choice from a short list, as large radio rows.
export function OptionList<T extends string>({ options, value, onChange, disabled = false }: Props<T>) {
  const styles = useStyles();
  return (
    <View style={styles.options} accessibilityRole="radiogroup">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <PressableScale
            key={option.value}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            scale={0.985}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled }}
            accessibilityLabel={`${option.label}. ${option.detail}`}
            style={[styles.option, selected && styles.optionSelected]}>
            <View style={[styles.radio, selected && styles.radioSelected]}>
              {selected ? <View style={styles.radioDot} /> : null}
            </View>
            <View style={styles.text}>
              <Text style={styles.label}>{option.label}</Text>
              <Text style={styles.detail}>{option.detail}</Text>
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  options: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.xs, gap: 2 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md + 2,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  optionSelected: { borderColor: t.focus, backgroundColor: t.background },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: t.borderFilled,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Selected: the accent with an Ink centre (brand rule: what sits on it is Ink).
  radioSelected: { borderColor: t.accentText, backgroundColor: t.accentText },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.onAccent },
  text: { flex: 1, gap: 1 },
  label: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  detail: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
}));
