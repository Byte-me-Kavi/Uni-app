import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import { WarningOctagonIcon } from 'phosphor-react-native/src/icons/WarningOctagon';

import { BackHeader } from '@/components/ui/back-header';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { ago } from '@/lib/feed';
import { KIND_LABEL, loadReportsQueue, openReport, snapshotText, type ReportGroup } from '@/lib/moderation';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

function dueText(due: string, now: number) {
  const left = new Date(due).getTime() - now;
  if (left <= 0) return 'Overdue';
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  return h > 0 ? `Due in ${h} h ${m} min` : `Due in ${m} min`;
}

// Staff: everything students reported in your universities, grouped by what was reported. Ragging,
// threats, self-harm and leaked exams first (2-hour target), then the oldest. Reports about your own
// batchmates go to a colleague.
export default function Reports() {
  const theme = useTheme();
  const styles = useStyles();
  const [groups, setGroups] = useState<ReportGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const r = await loadReportsQueue();
    setNow(Date.now());
    if (r.error !== null) setError(r.error);
    else {
      setError(null);
      setGroups(r.data);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <Screen style={styles.screen} edges={['top']}>
      <BackHeader title="Reports" />
      {!groups ? (
        <View style={styles.center}>
          {error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} />}
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => `${g.target_kind}:${g.target_id}`}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
              tintColor={theme.accentText}
            />
          }
          ListHeaderComponent={
            <View style={styles.header}>
              <PressableScale onPress={() => router.push('/admin/appeals')} accessibilityRole="button" style={styles.appeals}>
                <Text style={styles.appealsText}>Appeals waiting for a second moderator</Text>
              </PressableScale>
              <FormMessage message={error} />
            </View>
          }
          ListEmptyComponent={<Text style={styles.empty}>Nothing to review. New reports show up here.</Text>}
          renderItem={({ item }) => {
            const urgent = item.priority === 1;
            const due = dueText(item.due_at, now);
            const text = snapshotText(item.target_kind, item.snapshot).main;
            return (
              <PressableScale
                onPress={() => {
                  openReport(item);
                  router.push('/admin/report');
                }}
                accessibilityRole="button"
                scale={0.99}
                style={[styles.card, urgent && styles.cardUrgent]}>
                <View style={styles.top}>
                  {urgent ? (
                    <View style={styles.urgent}>
                      <WarningOctagonIcon size={14} weight="fill" color="#FFFFFF" />
                      <Text style={styles.urgentText}>{item.categories[0]}</Text>
                    </View>
                  ) : (
                    <View style={styles.category}>
                      <Text style={styles.categoryText}>{item.categories[0]}</Text>
                    </View>
                  )}
                  <Text style={[styles.due, due === 'Overdue' && styles.overdue]}>{due}</Text>
                </View>
                <Text style={styles.kind}>
                  {KIND_LABEL[item.target_kind] ?? item.target_kind}
                  {item.subject ? ` by ${item.subject.name}` : ''}, {item.institution}
                </Text>
                {text ? (
                  <Text style={styles.body} numberOfLines={3}>
                    {text}
                  </Text>
                ) : null}
                <Text style={styles.meta}>
                  {item.reports} {item.reports === 1 ? 'report' : 'reports'}, first {ago(item.first_at)}
                  {item.subject && item.subject.strikes > 0
                    ? `. ${item.subject.strikes} ${item.subject.strikes === 1 ? 'strike' : 'strikes'} in 90 days`
                    : ''}
                </Text>
              </PressableScale>
            );
          }}
        />
      )}
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  list: { padding: space.xl, paddingTop: space.sm, gap: space.md, width: '100%', maxWidth: 640, alignSelf: 'center' },
  header: { gap: space.sm },
  appeals: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.md },
  appealsText: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text, textAlign: 'center' },
  empty: { fontFamily: fonts.body, fontSize: 15, color: t.textMuted, textAlign: 'center', marginTop: space.xl },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  cardUrgent: { borderWidth: 1.5, borderColor: '#BE123C' },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: 2 },
  urgent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#BE123C',
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
  },
  urgentText: { fontFamily: fonts.bodyBold, fontSize: 12, color: '#FFFFFF' },
  category: { backgroundColor: t.background, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3 },
  categoryText: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.text },
  due: { marginLeft: 'auto', fontFamily: fonts.bodyBold, fontSize: 12, color: t.textMuted },
  overdue: { color: t.dangerText },
  kind: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.text },
  meta: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
}));
