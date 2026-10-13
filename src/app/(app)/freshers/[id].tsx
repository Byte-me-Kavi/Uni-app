import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TextInput, View } from 'react-native';
import { DotsThreeVerticalIcon } from 'phosphor-react-native/src/icons/DotsThreeVertical';
import { PaperPlaneRightIcon } from 'phosphor-react-native/src/icons/PaperPlaneRight';
import { SealCheckIcon } from 'phosphor-react-native/src/icons/SealCheck';

import { ReportSheet, type ReportTarget } from '@/components/chat/report-sheet';
import { ActionSheet, type SheetAction } from '@/components/ui/action-sheet';
import { Avatar } from '@/components/ui/avatar';
import { BackHeader } from '@/components/ui/back-header';
import { FormMessage } from '@/components/ui/form-message';
import { KeyboardFrame } from '@/components/ui/keyboard';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { ago } from '@/lib/feed';
import {
  answerFresher,
  deleteFresherItem,
  loadFresherQuestion,
  type FresherAnswer,
  type FresherQuestion,
  type QuestionsRole,
} from '@/lib/freshers';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Loaded = FresherQuestion & { role: QuestionsRole; answers: FresherAnswer[] };

// One freshers' question and its answers. Ambassadors and moderators answer at the bottom; anyone
// can report, and authors delete their own.
export default function FresherQuestionScreen() {
  const theme = useTheme();
  const styles = useStyles();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [q, setQ] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ kind: 'question' | 'answer'; id: number; mine: boolean; who: string | null } | null>(null);
  const [report, setReport] = useState<ReportTarget | null>(null);

  const load = useCallback(
    () =>
      loadFresherQuestion(id).then((r) => {
        if (r.error) setError(r.error);
        else setQ(r.data);
      }),
    [id],
  );

  useEffect(() => {
    loadFresherQuestion(id).then((r) => {
      if (r.error) setError(r.error);
      else setQ(r.data);
    });
  }, [id]);

  async function send() {
    setSending(true);
    setSendError(null);
    const r = await answerFresher(id, text);
    setSending(false);
    if (r.error) {
      setSendError(r.error);
      return;
    }
    setText('');
    load();
  }

  const answering = q?.role === 'ambassador' || q?.role === 'staff';

  const actions: SheetAction[] = !menu
    ? []
    : menu.mine || q?.role === 'staff'
      ? [
          {
            label: menu.mine ? 'Delete' : 'Remove',
            destructive: true,
            onPress: async () => {
              const r = await deleteFresherItem(menu.kind, menu.id);
              if (r.error) return setError(r.error);
              if (menu.kind === 'question') router.back();
              else load();
            },
          },
          ...(!menu.mine
            ? [
                {
                  label: 'Report',
                  onPress: () =>
                    setReport({
                      kind: menu.kind === 'question' ? 'fresher_question' : 'fresher_answer',
                      id: String(menu.id),
                      who: menu.who,
                      userId: null,
                    }),
                },
              ]
            : []),
        ]
      : [
          {
            label: 'Report',
            destructive: true,
            onPress: () =>
              setReport({
                kind: menu.kind === 'question' ? 'fresher_question' : 'fresher_answer',
                id: String(menu.id),
                who: menu.who,
                userId: null,
              }),
          },
        ];

  if (!q) {
    return (
      <Screen style={styles.screen}>
        <BackHeader title="Question" />
        <View style={styles.center}>
          {error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} />}
        </View>
      </Screen>
    );
  }

  const who = q.asker ? q.asker : q.mine ? 'You asked' : q.programme ? `A fresher in ${q.programme}` : 'A fresher';

  return (
    <Screen style={styles.screen}>
      <BackHeader title="Question" />
      <KeyboardFrame style={styles.flex}>
        <FlatList
          style={styles.flex}
          contentContainerStyle={styles.content}
          data={q.answers}
          keyExtractor={(a) => String(a.id)}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.question}>
              <View style={styles.questionTop}>
                <Text style={styles.asker}>
                  {who}, {ago(q.created_at)}
                </Text>
                <PressableScale
                  onPress={() => setMenu({ kind: 'question', id: q.id, mine: q.mine, who: null })}
                  accessibilityRole="button"
                  accessibilityLabel="More"
                  hitSlop={10}>
                  <DotsThreeVerticalIcon size={20} weight="bold" color={theme.onAccentTint} />
                </PressableScale>
              </View>
              <Text style={styles.questionText}>{q.body}</Text>
              <Text style={styles.count}>
                {q.answers.length === 0
                  ? answering
                    ? 'No answer yet. Yours will be the first.'
                    : 'Waiting for an ambassador to answer. You will get a notification.'
                  : `${q.answers.length} ${q.answers.length === 1 ? 'answer' : 'answers'}`}
              </Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          renderItem={({ item }) => (
            <View style={styles.answer}>
              <View style={styles.author}>
                <Avatar name={item.author.name} path={item.author.avatar_path} size={36} />
                <View style={styles.authorText}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.author.name}
                    </Text>
                    <View style={styles.badge}>
                      <SealCheckIcon size={12} weight="fill" color={theme.onAccent} />
                      <Text style={styles.badgeText}>{item.author.role}</Text>
                    </View>
                  </View>
                  <Text style={styles.meta} numberOfLines={1}>
                    {[item.author.programme, ago(item.created_at)].filter(Boolean).join(', ')}
                  </Text>
                </View>
                <PressableScale
                  onPress={() => setMenu({ kind: 'answer', id: item.id, mine: item.mine, who: item.author.name })}
                  accessibilityRole="button"
                  accessibilityLabel="More"
                  hitSlop={10}>
                  <DotsThreeVerticalIcon size={20} weight="bold" color={theme.textMuted} />
                </PressableScale>
              </View>
              <Text style={styles.answerText}>{item.body}</Text>
            </View>
          )}
        />
        {answering ? (
          <View style={styles.bar}>
            {sendError ? <FormMessage message={sendError} /> : null}
            <View style={styles.inputRow}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Write an answer"
                placeholderTextColor={theme.textMuted}
                multiline
                maxLength={1500}
                style={styles.input}
                accessibilityLabel="Answer"
              />
              <PressableScale
                onPress={send}
                disabled={text.trim().length < 2 || sending}
                accessibilityRole="button"
                accessibilityLabel="Send answer"
                hitSlop={6}
                style={[styles.send, { backgroundColor: theme.accent }, (text.trim().length < 2 || sending) && styles.disabled]}>
                {sending ? (
                  <ActivityIndicator size="small" color={theme.onAccent} />
                ) : (
                  <PaperPlaneRightIcon size={20} weight="fill" color={theme.onAccent} />
                )}
              </PressableScale>
            </View>
          </View>
        ) : null}
      </KeyboardFrame>

      <ActionSheet visible={!!menu} actions={actions} onClose={() => setMenu(null)} />
      <ReportSheet target={report} onClose={() => setReport(null)} />
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  content: { padding: space.xl, paddingTop: space.sm, width: '100%', maxWidth: 640, alignSelf: 'center' },
  question: { backgroundColor: t.accentTint, borderRadius: radius.lg, padding: space.lg, gap: space.sm, marginBottom: space.lg },
  questionTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  asker: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 13, color: t.onAccentTint },
  questionText: { fontFamily: fonts.bodyBold, fontSize: 18, lineHeight: 25, color: t.onAccentTint },
  count: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: t.onAccentTint },
  gap: { height: space.md },
  answer: { gap: space.sm, backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg },
  author: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  authorText: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  name: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: t.accent,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 11, color: t.onAccent },
  meta: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  answerText: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: t.text },
  bar: {
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderTopWidth: 1,
    borderTopColor: t.border,
    backgroundColor: t.background,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: {
    flex: 1,
    maxHeight: 140,
    minHeight: 44,
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingTop: 11,
    paddingBottom: 11,
    fontFamily: fonts.body,
    fontSize: 15,
    color: t.text,
  },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
}));
