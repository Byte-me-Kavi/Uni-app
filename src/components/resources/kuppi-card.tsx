import { router } from 'expo-router';
import { memo } from 'react';
import { Text, View } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { monthShort } from '@/lib/dates';
import { kuppiPlace, kuppiWhen, PLATFORM_LABEL, type Kuppi } from '@/lib/kuppi';
import { useModuleColour } from '@/lib/module-colours';
import { createThemedStyles, fonts, radius, space } from '@/theme/tokens';

// A kuppi in a list: the date at a glance (in the module's colour), the topic and module, and where
// the student stands.
export const KuppiCard = memo(function KuppiCard({ kuppi }: { kuppi: Kuppi }) {
  const styles = useStyles();
  const colour = useModuleColour(kuppi.module.id);
  const start = new Date(kuppi.starts_at);
  const status = kuppi.cancelled
    ? 'Cancelled'
    : kuppi.hosting
      ? 'Hosting'
      : kuppi.rsvped
        ? 'Going'
        : kuppi.full
          ? 'Full'
          : null;
  const where = kuppi.mode === 'online' ? (kuppi.platform ? PLATFORM_LABEL[kuppi.platform] : 'Online') : kuppi.venue;
  return (
    <PressableScale
      scale={0.985}
      onPress={() => router.push({ pathname: '/kuppi/[id]', params: { id: kuppi.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${kuppi.title}, ${kuppiPlace(kuppi)}, ${kuppiWhen(kuppi)}${status ? `, ${status}` : ''}`}
      style={[styles.card, kuppi.cancelled && styles.cancelled]}>
      <View style={[styles.date, { backgroundColor: colour.bg }]}>
        <Text style={[styles.month, { color: colour.fg }]}>{monthShort(start).toUpperCase()}</Text>
        <Text style={styles.day}>{start.getDate()}</Text>
      </View>
      <View style={styles.copy}>
        <Text style={styles.code} numberOfLines={1}>
          {kuppiPlace(kuppi)}
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          {kuppi.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {kuppiWhen(kuppi).split(' · ')[1]} · {where}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {kuppi.host?.name ?? 'A student'} · {kuppi.going} of {kuppi.capacity} going
        </Text>
      </View>
      {status ? (
        <View style={[styles.badge, (status === 'Going' || status === 'Hosting') && styles.badgeOn]}>
          <Text style={[styles.badgeText, (status === 'Going' || status === 'Hosting') && styles.badgeTextOn]}>{status}</Text>
        </View>
      ) : null}
    </PressableScale>
  );
});

const useStyles = createThemedStyles((t) => ({
  card: { flexDirection: 'row', gap: space.md, backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg },
  cancelled: { opacity: 0.6 },
  date: {
    width: 52,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: t.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  month: { fontFamily: fonts.bodyBold, fontSize: 11, color: t.accentText, letterSpacing: 0.5 },
  day: { fontFamily: fonts.display, fontSize: 22, color: t.text, lineHeight: 26 },
  copy: { flex: 1, gap: 2 },
  code: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.accentText },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 21, color: t.text },
  meta: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: t.background,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  // Going and hosting: the accent with Ink text (brand rule).
  badgeOn: { backgroundColor: t.accent },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.text },
  badgeTextOn: { color: t.onAccent },
}));
