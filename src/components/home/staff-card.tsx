import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { ShieldCheckIcon } from 'phosphor-react-native/src/icons/ShieldCheck';

import { PressableScale } from '@/components/ui/pressable-scale';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Props = { count: number; role: 'admin' | 'moderator' };

// Only for moderators and admins. A real count from the approval queue (students, and freshers for
// national admins); the accent only when there is something to do (brand rule: the accent means
// something to do). Opens Approvals.
export function StaffCard({ count, role }: Props) {
  const theme = useTheme();
  const styles = useStyles();
  const waiting = count > 0;

  return (
    <PressableScale
      onPress={() => router.push('/admin/approvals')}
      accessibilityRole="button"
      accessibilityLabel={`${count} accounts waiting for approval. Open approvals`}
      scale={0.99}
      style={styles.card}>
      <View style={[styles.icon, waiting && styles.iconWaiting]}>
        <ShieldCheckIcon size={22} weight="bold" color={waiting ? theme.onAccent : theme.textMuted} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{waiting ? 'Accounts waiting' : 'All caught up'}</Text>
        <Text style={styles.body}>
          {waiting
            ? 'Tap to review them.'
            : role === 'admin'
              ? 'No sign-ups are waiting for approval.'
              : 'No sign-ups at your university are waiting.'}
        </Text>
      </View>
      <Text style={[styles.count, !waiting && styles.countQuiet]}>{count}</Text>
      <CaretRightIcon size={18} weight="bold" color={theme.textMuted} />
    </PressableScale>
  );
}

const useStyles = createThemedStyles((t) => ({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.background,
  },
  iconWaiting: { backgroundColor: t.accent },
  copy: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
  count: { fontFamily: fonts.display, fontSize: 30, color: t.text, fontVariant: ['tabular-nums'] },
  countQuiet: { color: t.textMuted },
}));
