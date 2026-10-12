import { Text, View } from 'react-native';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { PressableScale } from '@/components/ui/pressable-scale';
import { setThemeName, THEME_NAMES, useScheme, useThemeName } from '@/theme/appearance';
import { createThemedStyles, fonts, paletteFor, radius, space, THEMES, useTheme } from '@/theme/tokens';

// Choose the app's colours. Each choice shows its page colour with its accent on it; the app changes
// as soon as one is tapped.
export function ThemeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const styles = useStyles();
  const current = useThemeName();
  const scheme = useScheme();
  return (
    <BottomSheet visible={visible} title="Theme" onClose={onClose} height={0.7}>
      <View style={styles.body}>
        {THEME_NAMES.map((name) => {
          const look = paletteFor(name, scheme);
          const selected = name === current;
          return (
            <PressableScale
              key={name}
              onPress={() => setThemeName(name)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={THEMES[name].label}
              scale={0.985}
              style={[styles.row, selected && styles.rowSelected]}>
              <View style={[styles.preview, { backgroundColor: look.background, borderColor: look.border }]}>
                <View style={[styles.previewSurface, { backgroundColor: look.surface }]} />
                <View style={[styles.previewAccent, { backgroundColor: look.accent }]} />
              </View>
              <Text style={styles.label}>{THEMES[name].label}</Text>
              {selected ? <CheckIcon size={20} weight="bold" color={theme.accentText} /> : null}
            </PressableScale>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const useStyles = createThemedStyles((t) => ({
  body: { paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 60,
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: t.border,
  },
  rowSelected: { borderColor: t.accentText },
  preview: { width: 52, height: 40, borderRadius: radius.sm, borderWidth: 1, padding: 5, gap: 4, overflow: 'hidden' },
  previewSurface: { height: 10, borderRadius: 3 },
  previewAccent: { height: 12, width: 28, borderRadius: 6 },
  label: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
}));
