import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { FilePdfIcon } from 'phosphor-react-native/src/icons/FilePdf';
import { ImageIcon } from 'phosphor-react-native/src/icons/Image';
import { WarningIcon } from 'phosphor-react-native/src/icons/Warning';

import { ActionSheet } from '@/components/ui/action-sheet';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { ago } from '@/lib/feed';
import { loadFresherBatches, loadFresherQueue, startBatch, type FresherBatch, type QueuedFresher } from '@/lib/freshers';
import { supabase } from '@/lib/supabase';
import { useHomeData } from '@/providers/home-provider';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Tab = 'students' | 'freshers' | 'batches';
type Student = { user_id: string; full_name: string; email: string; institution_name: string; registered_at: string };

const TABS: { key: Tab; label: string }[] = [
  { key: 'students', label: 'Students' },
  { key: 'freshers', label: 'Freshers' },
  { key: 'batches', label: 'Fresher batches' },
];

// Reasons a moderator gives when a sign-up is not a student here. The student sees the reason.
const STUDENT_REASONS = [
  'This email does not belong to a student at this university.',
  'This student already has a Uni Era account.',
  'We could not confirm you are a student here.',
];

// Staff: sign-ups waiting for approval. Students (university email) in the staff member's scope;
// freshers (selection letter) for national admins; and fresher batches, to open once lectures start.
export default function Approvals() {
  const theme = useTheme();
  const styles = useStyles();
  const { refresh: refreshHome } = useHomeData();
  const [tab, setTab] = useState<Tab>('students');
  const [students, setStudents] = useState<Student[] | null>(null);
  const [freshers, setFreshers] = useState<QueuedFresher[] | null>(null);
  const [batches, setBatches] = useState<FresherBatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Student | null>(null);
  const [starting, setStarting] = useState<FresherBatch | null>(null);

  const load = useCallback(async (which: Tab) => {
    setError(null);
    if (which === 'students') {
      const { data, error: e } = await supabase.rpc('pending_accounts', {});
      if (e) setError(e.message);
      else setStudents((data ?? []) as Student[]);
    } else if (which === 'freshers') {
      const r = await loadFresherQueue();
      if (r.error) setError(r.error);
      else setFreshers(r.data);
    } else {
      const r = await loadFresherBatches();
      if (r.error) setError(r.error);
      else setBatches(r.data);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(tab);
    }, [load, tab]),
  );

  async function review(student: Student, decision: 'approved' | 'rejected', reason?: string) {
    setBusy(student.user_id);
    const { error: e } = await supabase.rpc('review_account', {
      p_user_id: student.user_id,
      p_decision: decision,
      p_reason: reason,
    });
    setBusy(null);
    if (e) {
      setError(e.message);
      return;
    }
    setStudents((list) => list?.filter((s) => s.user_id !== student.user_id) ?? null);
    refreshHome();
  }

  async function start(batch: FresherBatch) {
    setBusy(String(batch.id));
    const r = await startBatch(batch.id);
    setBusy(null);
    if (r.error) {
      setError(r.error);
      return;
    }
    setBatches((list) => list?.filter((b) => b.id !== batch.id) ?? null);
  }

  const data = tab === 'students' ? students : tab === 'freshers' ? freshers : batches;

  return (
    <Screen style={styles.screen} edges={['top']}>
      <BackHeader title="Approvals" />
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((t) => (
          <PressableScale
            key={t.key}
            onPress={() => setTab(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
            style={[styles.tab, tab === t.key && styles.tabOn]}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
          </PressableScale>
        ))}
      </View>
      <View style={styles.message}>
        <FormMessage message={error} />
      </View>
      {data === null ? (
        error ? null : (
          <ActivityIndicator style={styles.loading} color={theme.accentText} />
        )
      ) : (
        <FlatList<Student | QueuedFresher | FresherBatch>
          data={data as (Student | QueuedFresher | FresherBatch)[]}
          keyExtractor={(item) => ('id' in item ? String(item.id) : item.user_id)}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {tab === 'students'
                ? 'No students are waiting.'
                : tab === 'freshers'
                  ? 'No freshers are waiting. New letters show up here.'
                  : 'No batches are waiting to start.'}
            </Text>
          }
          renderItem={({ item }) => {
            if (tab === 'students') {
              const s = item as Student;
              return (
                <View style={styles.card}>
                  <Text style={styles.title}>{s.email}</Text>
                  <Text style={styles.meta}>
                    {s.institution_name}, signed up {ago(s.registered_at)}
                  </Text>
                  <View style={styles.actions}>
                    <View style={styles.action}>
                      <Button label="Approve" loading={busy === s.user_id} onPress={() => review(s, 'approved')} />
                    </View>
                    <View style={styles.action}>
                      <Button label="Not a student" variant="quiet" onPress={() => setRejecting(s)} />
                    </View>
                  </View>
                </View>
              );
            }
            if (tab === 'freshers') {
              const f = item as QueuedFresher;
              const Icon = f.mime === 'application/pdf' ? FilePdfIcon : ImageIcon;
              return (
                <PressableScale
                  onPress={() =>
                    router.push({
                      pathname: '/admin/fresher/[id]',
                      params: { id: f.user_id, email: f.email, mime: f.mime, same: String(f.same_file) },
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Review ${f.email}`}
                  style={[styles.card, styles.row]}>
                  <View style={styles.fileIcon}>
                    <Icon size={22} weight="bold" color={theme.onAccentTint} />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.title} numberOfLines={1}>
                      {f.email}
                    </Text>
                    <Text style={styles.meta}>Letter sent {ago(f.submitted_at)}</Text>
                    {f.same_file > 0 ? (
                      <View style={styles.flag}>
                        <WarningIcon size={14} weight="fill" color={theme.dangerText} />
                        <Text style={styles.flagText}>
                          Same file as {f.same_file} other {f.same_file === 1 ? 'account' : 'accounts'}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </PressableScale>
              );
            }
            const b = item as FresherBatch;
            return (
              <View style={styles.card}>
                <Text style={styles.title}>{b.name}</Text>
                <Text style={styles.meta}>
                  {b.members} {b.members === 1 ? 'member' : 'members'}, {b.freshers} still{' '}
                  {b.freshers === 1 ? 'a fresher' : 'freshers'}
                </Text>
                <Button
                  label="Lectures have started"
                  variant="quiet"
                  loading={busy === String(b.id)}
                  onPress={() => setStarting(b)}
                />
              </View>
            );
          }}
        />
      )}

      <ActionSheet
        visible={!!rejecting}
        title="Why can't they join?"
        message="The student sees this reason."
        actions={STUDENT_REASONS.map((reason) => ({
          label: reason,
          destructive: true,
          onPress: () => {
            if (rejecting) review(rejecting, 'rejected', reason);
          },
        }))}
        onClose={() => setRejecting(null)}
      />
      <ActionSheet
        visible={!!starting}
        title={starting ? `Open ${starting.name}?` : undefined}
        message="Students of this intake who sign up with their university email can join it, and you can appoint batch reps. Freshers keep their limits until they verify."
        actions={[{ label: 'Lectures have started', onPress: () => starting && start(starting) }]}
        onClose={() => setStarting(null)}
      />
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.xl, paddingBottom: space.sm },
  tab: { paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: t.surface },
  tabOn: { backgroundColor: t.focus },
  tabText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  tabTextOn: { color: t.background },
  message: { paddingHorizontal: space.xl },
  loading: { marginTop: space.xxl },
  list: { padding: space.xl, paddingTop: space.sm, gap: 0, width: '100%', maxWidth: 640, alignSelf: 'center' },
  gap: { height: space.md },
  empty: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted, textAlign: 'center', marginTop: space.xl },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowText: { flex: 1, gap: 2 },
  fileIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: t.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  meta: { fontFamily: fonts.body, fontSize: 14, color: t.textMuted },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  flagText: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.dangerText },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  action: { flex: 1 },
}));
