import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import { ChatsCircleIcon } from 'phosphor-react-native/src/icons/ChatsCircle';
import { HourglassMediumIcon } from 'phosphor-react-native/src/icons/HourglassMedium';
import { SealCheckIcon } from 'phosphor-react-native/src/icons/SealCheck';

import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { KeyboardFrame } from '@/components/ui/keyboard';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { ago } from '@/lib/feed';
import { askFreshers, loadFresherQuestions, type FresherQuestion, type QuestionsPage } from '@/lib/freshers';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Row =
  { key: string; kind: 'heading'; label: string } | { key: string; kind: 'question'; q: FresherQuestion; waiting: boolean };

// Freshers ask the ambassadors of their university; ambassadors and moderators answer. Freshers see
// their own questions waiting and every answered one; ambassadors see the waiting ones first.
export default function FreshersQuestions() {
  const theme = useTheme();
  const styles = useStyles();
  const [page, setPage] = useState<QuestionsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [text, setText] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [more, setMore] = useState(true);

  const load = useCallback(async () => {
    const r = await loadFresherQuestions();
    if (r.error !== null) setError(r.error);
    else {
      setError(null);
      setPage(r.data);
      setMore(r.data.answered.length >= 30);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function loadMore() {
    const last = page?.answered.at(-1)?.answered_at;
    if (!page || !more || !last) return;
    const r = await loadFresherQuestions(last);
    if (r.data) {
      setPage({ ...page, answered: [...page.answered, ...r.data.answered] });
      setMore(r.data.answered.length >= 30);
    }
  }

  async function ask() {
    setAsking(true);
    setAskError(null);
    const r = await askFreshers(text);
    setAsking(false);
    if (r.error !== null) {
      setAskError(r.error);
      return;
    }
    const asked = r.data;
    setText('');
    setPage((p) => (p ? { ...p, waiting: [...p.waiting, asked] } : p));
  }

  const fresher = page?.role === 'fresher';
  const rows: Row[] = [];
  if (page) {
    if (page.waiting.length > 0) {
      rows.push({
        key: 'h-waiting',
        kind: 'heading',
        label: fresher ? 'Your questions waiting for an answer' : 'Waiting for an answer',
      });
      for (const q of page.waiting) rows.push({ key: `w${q.id}`, kind: 'question', q, waiting: true });
    }
    if (page.answered.length > 0) {
      rows.push({ key: 'h-answered', kind: 'heading', label: 'Answered' });
      for (const q of page.answered) rows.push({ key: `a${q.id}`, kind: 'question', q, waiting: false });
    }
  }

  const header = page ? (
    <View style={styles.header}>
      <View style={styles.intro}>
        <ChatsCircleIcon size={28} weight="fill" color={theme.onAccentTint} />
        <Text style={styles.introText}>
          {fresher
            ? `Ask the ambassadors at ${page.university}: seniors chosen by the Uni Era team. They see your programme, never your name.`
            : `Freshers at ${page.university} ask here before they arrive. They see your name and an ambassador badge on your answers.`}
        </Text>
      </View>
      {fresher ? (
        <View style={styles.ask}>
          <TextField
            label="Your question"
            value={text}
            onChangeText={setText}
            placeholder="Registration, hostels, what to bring…"
            multiline
            maxLength={500}
          />
          <FormMessage message={askError} />
          <Button label="Ask" onPress={ask} loading={asking} disabled={text.trim().length < 10} />
        </View>
      ) : null}
    </View>
  ) : null;

  return (
    <Screen style={styles.screen} edges={['top']}>
      <BackHeader title="Freshers' questions" />
      <KeyboardFrame style={styles.flex}>
        {!page ? (
          <View style={styles.center}>
            {error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} />}
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(r) => r.key}
            ListHeaderComponent={header}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            onEndReached={loadMore}
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
            ListEmptyComponent={
              <Text style={styles.empty}>
                {fresher
                  ? 'No answered questions yet. Be the first to ask.'
                  : 'No questions yet. You will get a notification when a fresher asks.'}
              </Text>
            }
            renderItem={({ item }) =>
              item.kind === 'heading' ? (
                <Text style={styles.heading} accessibilityRole="header">
                  {item.label}
                </Text>
              ) : (
                <QuestionRow q={item.q} waiting={item.waiting} />
              )
            }
          />
        )}
      </KeyboardFrame>
    </Screen>
  );
}

function QuestionRow({ q, waiting }: { q: FresherQuestion; waiting: boolean }) {
  const theme = useTheme();
  const styles = useStyles();
  const who = q.asker ? q.asker : q.mine ? 'You' : q.programme ? `A fresher in ${q.programme}` : 'A fresher';
  return (
    <PressableScale
      onPress={() => router.push({ pathname: '/freshers/[id]', params: { id: String(q.id) } })}
      accessibilityRole="button"
      scale={0.99}
      style={[styles.card, waiting && styles.cardWaiting]}>
      <Text style={styles.body} numberOfLines={4}>
        {q.body}
      </Text>
      <View style={styles.metaRow}>
        <Text style={styles.meta} numberOfLines={1}>
          {who}, {ago(q.created_at)}
        </Text>
        {waiting ? (
          <View style={styles.state}>
            <HourglassMediumIcon size={14} weight="bold" color={theme.textMuted} />
            <Text style={styles.stateText}>Waiting</Text>
          </View>
        ) : (
          <View style={[styles.state, styles.stateAnswered]}>
            <SealCheckIcon size={14} weight="fill" color={theme.onAccentTint} />
            <Text style={[styles.stateText, styles.stateTextAnswered]}>
              {q.answer_count} {q.answer_count === 1 ? 'answer' : 'answers'}
            </Text>
          </View>
        )}
      </View>
    </PressableScale>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  list: { padding: space.xl, paddingTop: space.sm, gap: space.md, width: '100%', maxWidth: 640, alignSelf: 'center' },
  header: { gap: space.lg, marginBottom: space.sm },
  intro: { flexDirection: 'row', gap: space.md, backgroundColor: t.accentTint, borderRadius: radius.lg, padding: space.lg },
  introText: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 21, color: t.onAccentTint },
  ask: { gap: space.sm },
  heading: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted, marginTop: space.sm },
  empty: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted, textAlign: 'center', marginTop: space.lg },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  cardWaiting: { borderWidth: 1.5, borderColor: t.border, backgroundColor: t.background },
  body: { fontFamily: fonts.bodySemiBold, fontSize: 16, lineHeight: 22, color: t.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  meta: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  state: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    backgroundColor: t.surface,
  },
  stateAnswered: { backgroundColor: t.accentTint },
  stateText: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.textMuted },
  stateTextAnswered: { color: t.onAccentTint },
}));
