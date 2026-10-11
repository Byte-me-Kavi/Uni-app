import { Text, View } from 'react-native';
import { ShieldCheckIcon } from 'phosphor-react-native/src/icons/ShieldCheck';

import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Props = { count: number; role: 'admin' | 'moderator' };

// Only for moderators and admins. A real count from the approval queue; the accent only when there is
// something to do (brand rule: the accent means something to do).
export function StaffCard({ count, role }: Props) {
  const theme = useTheme();
  const styles = useStyles();
  const waiting = count > 0;

  return (
    <View style={styles.card} accessible accessibilityLabel={`${count} accounts waiting for approval`}>
      <View style={[styles.icon, waiting && styles.iconWaiting]}>
        <ShieldCheckIcon size={22} weight="bold" color={waiting ? brand.ink : theme.textMuted} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{waiting ? 'Accounts waiting' : 'All caught up'}</Text>
        <Text style={styles.body}>
          {waiting
            ? 'Review them on the admin dashboard.'
            : role === 'admin'
              ? 'No sign-ups are waiting for approval.'
              : 'No sign-ups at your university are waiting.'}
        </Text>
      </View>
      <Text style={[styles.count, !waiting && styles.countQuiet]}>{count}</Text>
    </View>
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
  iconWaiting: { backgroundColor: brand.accent },
  copy: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
  count: { fontFamily: fonts.display, fontSize: 30, color: t.text, fontVariant: ['tabular-nums'] },
  countQuiet: { color: t.textMuted },
}));
