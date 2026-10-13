import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';

import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { KeyboardFrame } from '@/components/ui/keyboard';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { ago } from '@/lib/feed';
import { ACTION_LABEL, decideAppeal, KIND_LABEL, loadAppealsQueue, snapshotText, type QueuedAppeal } from '@/lib/moderation';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// Staff: appeals against actions other moderators took. You never see appeals against your own.
export default function Appeals() {
  const theme = useTheme();
  const styles = useStyles();
  const [list, setList] = useState<QueuedAppeal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await loadAppealsQueue();
    if (r.error !== null) setError(r.error);
    else setList(r.data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <Screen style={styles.screen} edges={['top']}>
      <BackHeader title="Appeals" />
      <KeyboardFrame style={styles.flex}>
        {!list ? (
          <View style={styles.center}>
            {error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} />}
          </View>
        ) : (
          <FlatList
            data={list}
            keyExtractor={(a) => a.id}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={styles.empty}>No appeals are waiting.</Text>}
            renderItem={({ item }) => (
              <AppealCard appeal={item} onDone={(id) => setList((l) => l?.filter((a) => a.id !== id) ?? null)} />
            )}
          />
        )}
      </KeyboardFrame>
    </Screen>
  );
}

function AppealCard({ appeal, onDone }: { appeal: QueuedAppeal; onDone: (id: string) => void }) {
  const styles = useStyles();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'upheld' | 'overturned' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const evidence = appeal.action.target_kind ? snapshotText(appeal.action.target_kind, appeal.snapshot).main : '';

  async function decide(decision: 'upheld' | 'overturned') {
    setBusy(decision);
    setError(null);
    const r = await decideAppeal(appeal.id, decision, note);
    setBusy(null);
    if (r.error !== null) setError(r.error);
    else onDone(appeal.id);
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        {ACTION_LABEL[appeal.action.action]} for {appeal.subject?.name ?? 'a student'}
      </Text>
      <Text style={styles.meta}>
        By {appeal.moderator ?? 'a moderator'} {ago(appeal.action.created_at)}.{' '}
        {appeal.subject ? `${appeal.subject.strikes} ${appeal.subject.strikes === 1 ? 'strike' : 'strikes'} in 90 days.` : ''}
      </Text>
      <View style={styles.quote}>
        <Text style={styles.label}>Reason given</Text>
        <Text style={styles.text}>{appeal.action.reason}</Text>
      </View>
      {evidence ? (
        <View style={styles.quote}>
          <Text style={styles.label}>{KIND_LABEL[appeal.action.target_kind ?? ''] ?? 'Reported'}</Text>
          <Text style={styles.text}>{evidence}</Text>
        </View>
      ) : null}
      <View style={[styles.quote, styles.appeal]}>
        <Text style={styles.label}>Their appeal</Text>
        <Text style={styles.text}>{appeal.statement}</Text>
      </View>
      <TextField label="Note to the student (optional)" value={note} onChangeText={setNote} multiline maxLength={1000} />
      <FormMessage message={error} />
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button label="Overturn" loading={busy === 'overturned'} onPress={() => decide('overturned')} />
        </View>
        <View style={styles.action}>
          <Button label="Keep it" variant="quiet" loading={busy === 'upheld'} onPress={() => decide('upheld')} />
        </View>
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  list: { padding: space.xl, paddingTop: space.sm, gap: space.md, width: '100%', maxWidth: 640, alignSelf: 'center' },
  empty: { fontFamily: fonts.body, fontSize: 15, color: t.textMuted, textAlign: 'center', marginTop: space.xl },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  title: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  meta: { fontFamily: fonts.body, fontSize: 14, color: t.textMuted },
  quote: { backgroundColor: t.background, borderRadius: radius.md, padding: space.md, gap: 2 },
  appeal: { borderWidth: 1.5, borderColor: t.accent },
  label: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.textMuted },
  text: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.text },
  actions: { flexDirection: 'row', gap: space.sm },
  action: { flex: 1 },
}));
