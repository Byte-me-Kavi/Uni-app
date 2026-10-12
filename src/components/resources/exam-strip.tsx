import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { CalendarPlusIcon } from 'phosphor-react-native/src/icons/CalendarPlus';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';

import { ModuleDot } from '@/components/resources/module-dot';
import { PressableScale } from '@/components/ui/pressable-scale';
import { daysText, EXAM_SEASON_DAYS, examLabel, useMyExams } from '@/lib/exams';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// The next exams, counting down ("CS2012 · Final exam in 12 days"). Each opens its module, where
// past papers come first. Shows nothing outside exam season, except a prompt for reps to add dates.
export function ExamStrip({ limit = 3 }: { limit?: number }) {
  const theme = useTheme();
  const styles = useStyles();
  const { data } = useMyExams();
  const soon = (data?.exams ?? []).filter((e) => e.days <= EXAM_SEASON_DAYS).slice(0, limit);

  if (soon.length === 0) {
    return data?.can_edit && (data.exams.length ?? 0) === 0 ? (
      // In the theme's tint with a button, so reps notice it: one rep adding dates gives the whole
      // batch countdowns and past papers first.
      <View style={styles.prompt}>
        <CalendarPlusIcon size={22} weight="bold" color={theme.onAccentTint} />
        <View style={styles.promptCopy}>
          <Text style={styles.promptTitle}>Exam dates</Text>
          <Text style={styles.promptText} numberOfLines={2}>
            Countdowns for your whole batch
          </Text>
        </View>
        <PressableScale onPress={() => router.push('/exams')} accessibilityRole="button" accessibilityLabel="Add exam dates" style={styles.promptButton}>
          <Text style={styles.promptButtonText}>Add dates</Text>
        </PressableScale>
      </View>
    ) : null;
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">
          Exams coming up
        </Text>
        <PressableScale onPress={() => router.push('/exams')} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.link}>All dates</Text>
        </PressableScale>
      </View>
      {soon.map((e) => (
        <PressableScale
          key={e.id}
          onPress={() => router.push({ pathname: '/module/[id]', params: { id: String(e.module.id) } })}
          accessibilityRole="button"
          accessibilityLabel={`${e.module.name}, ${e.module.code}, ${examLabel(e.kind)} ${daysText(e.days)}`}
          style={styles.row}>
          <View style={[styles.days, e.days <= 7 && styles.daysSoon]}>
            {e.days <= 0 ? (
              <Text style={[styles.daysToday, styles.daysTextSoon]}>Today</Text>
            ) : (
              <>
                <Text style={[styles.daysNumber, e.days <= 7 && styles.daysTextSoon]}>{e.days}</Text>
                <Text style={[styles.daysLabel, e.days <= 7 && styles.daysTextSoon]}>{e.days === 1 ? 'day' : 'days'}</Text>
              </>
            )}
          </View>
          <View style={styles.copy}>
            <View style={styles.moduleLine}>
              <ModuleDot id={e.module.id} size={8} />
              <Text style={[styles.code, styles.shrink]} numberOfLines={1}>
                {e.module.code} · {e.module.name}
              </Text>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {examLabel(e.kind)} {daysText(e.days)}
            </Text>
          </View>
          <CaretRightIcon size={16} weight="bold" color={theme.textMuted} />
        </PressableScale>
      ))}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  card: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  link: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.accentText },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52 },
  moduleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shrink: { flexShrink: 1 },
  days: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: t.background, alignItems: 'center', justifyContent: 'center' },
  // The last week: the accent with Ink text (brand rule).
  daysSoon: { backgroundColor: t.accent },
  daysNumber: { fontFamily: fonts.display, fontSize: 18, lineHeight: 21, color: t.text },
  daysLabel: { fontFamily: fonts.bodyBold, fontSize: 10, color: t.textMuted },
  daysToday: { fontFamily: fonts.bodyBold, fontSize: 12 },
  daysTextSoon: { color: t.onAccent },
  copy: { flex: 1, gap: 1 },
  code: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.accentText },
  name: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: t.text },
  // The theme's soft highlight (light blue in Sky), one compact row.
  prompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: t.accentTint,
    borderRadius: radius.lg,
    paddingVertical: space.sm + 2,
    paddingLeft: space.lg,
    paddingRight: space.sm + 2,
  },
  promptCopy: { flex: 1, gap: 1 },
  promptTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.onAccentTint },
  promptText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: t.onAccentTint },
  // The accent with its own text colour (Ink, or white on deep accents).
  promptButton: { backgroundColor: t.accent, borderRadius: radius.pill, paddingHorizontal: space.md + 2, minHeight: 36, justifyContent: 'center' },
  promptButtonText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.onAccent },
}));
