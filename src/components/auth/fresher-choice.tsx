import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { StudentIcon } from 'phosphor-react-native/src/icons/Student';

import { PressableScale } from '@/components/ui/pressable-scale';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// The way in for freshers, at the top of sign-up where they look first: most new students get
// their university email weeks after the UGC selection, so this is their main door, not a footnote.
export function FresherChoice() {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <PressableScale
      onPress={() => router.push('/fresher-sign-up')}
      accessibilityRole="button"
      accessibilityLabel="Just selected by the UGC and no university email yet? Join as a fresher with your selection letter"
      scale={0.98}
      style={styles.card}>
      <View style={styles.icon}>
        <StudentIcon size={24} weight="bold" color={theme.onAccent} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>No university email yet?</Text>
        <Text style={styles.body}>Just selected by the UGC? Join as a fresher with your selection letter.</Text>
      </View>
      <CaretRightIcon size={20} weight="bold" color={theme.onAccentTint} />
    </PressableScale>
  );
}

const useStyles = createThemedStyles((t) => ({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: t.accentTint,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.onAccentTint },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.onAccentTint },
}));
