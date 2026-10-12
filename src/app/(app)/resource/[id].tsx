import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';
import { ThumbsUpIcon } from 'phosphor-react-native/src/icons/ThumbsUp';
import { XIcon } from 'phosphor-react-native/src/icons/X';

import { ReportSheet, type ReportTarget } from '@/components/chat/report-sheet';
import { ActionSheet, type SheetAction } from '@/components/ui/action-sheet';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { KeyboardFrame, KeyboardScroll } from '@/components/ui/keyboard';
import { listTime } from '@/lib/chat/format';
import { signedUrl } from '@/lib/chat/media-urls';
import { keepOffline, offlineCopy } from '@/lib/chat/transfer';
import {
  addComment,
  deleteComment,
  loadComments,
  loadShared,
  openShared,
  SHARED_CATEGORIES,
  sharedFileName,
  voteComment,
  type Comment,
  type SharedDetail,
} from '@/lib/shared';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// A shared file: open it, keep it offline, and its discussion. Past papers are discussed question by
// question ("Q3(b)"), with the most helpful answers first, so a paper collects its worked answers.
export default function Resource() {
  const theme = useTheme();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [file, setFile] = useState<SharedDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  const [question, setQuestion] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [version, setVersion] = useState(0);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [draft, setDraft] = useState('');
  const [draftQuestion, setDraftQuestion] = useState('');
  const [posting, setPosting] = useState(false);
  const [menu, setMenu] = useState<Comment | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);

  useEffect(() => {
    let live = true;
    loadShared(id).then((r) => {
      if (!live) return;
      setFile(r.file);
      setError(r.error);
      if (r.file) offlineCopy({ path: r.file.key, name: sharedFileName(r.file) }).then((uri) => live && setKept(!!uri));
    });
    return () => {
      live = false;
    };
  }, [id, version]);

  useEffect(() => {
    let live = true;
    loadComments(id, question).then((r) => live && r.comments && setComments(r.comments));
    return () => {
      live = false;
    };
  }, [id, question, version]);

  const replace = useCallback((next: Comment) => {
    const swap = (list: Comment[]): Comment[] =>
      list.map((c) =>
        c.id === next.id ? { ...next, replies: c.replies } : { ...c, replies: c.replies ? swap(c.replies) : c.replies },
      );
    setComments((list) => (list ? swap(list) : list));
  }, []);

  async function open() {
    if (!file) return;
    setNote('Opening…');
    setNote(await openShared(file));
  }

  async function keep() {
    if (!file) return;
    setNote('Saving…');
    try {
      const url = await signedUrl(file.key);
      if (!url) throw new Error('no link');
      await keepOffline({ url, path: file.key, name: sharedFileName(file) });
      setKept(true);
      setNote(null);
    } catch {
      setNote('Could not save. Check your connection and try again.');
    }
  }

  async function post() {
    if (!draft.trim()) return;
    setPosting(true);
    setNote(null);
    const { error: e } = await addComment(
      id,
      draft.trim(),
      replyTo ? null : draftQuestion.trim() || question,
      replyTo?.id ?? null,
    );
    setPosting(false);
    if (e) return setNote(e);
    setDraft('');
    setDraftQuestion('');
    setReplyTo(null);
    setVersion((v) => v + 1);
  }

  async function vote(c: Comment) {
    const { comment, error: e } = await voteComment(c.id, !c.voted);
    if (e) return setNote(e);
    if (comment) replace(comment);
  }

  if (!file) {
    return (
      <Screen style={styles.screen}>
        <BackHeader title="File" />
        <View style={styles.center}>
          {error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} />}
        </View>
      </Screen>
    );
  }

  const category = SHARED_CATEGORIES.find((c) => c.key === file.category)?.label ?? 'File';
  const pastPaper = file.category === 'past_papers';
  const menuActions: SheetAction[] = menu
    ? menu.mine || file.can_moderate
      ? [
          {
            label: 'Delete comment',
            destructive: true,
            onPress: async () => {
              const e = await deleteComment(menu.id);
              if (e) setNote(e);
              else setVersion((v) => v + 1);
            },
          },
        ]
      : [
          {
            label: 'Report comment',
            destructive: true,
            onPress: () =>
              setReporting({ kind: 'comment', id: menu.id, who: menu.author?.name ?? null, userId: menu.author?.id ?? null }),
          },
        ]
    : [];

  const renderComment = (c: Comment, reply = false) => (
    <View key={c.id} style={[styles.comment, reply && styles.reply]}>
      <View style={styles.commentHead}>
        <Text style={styles.author}>{c.deleted ? 'Deleted' : (c.author?.name ?? 'Student')}</Text>
        {c.question && !reply ? <Text style={styles.qBadge}>{c.question}</Text> : null}
        <Text style={styles.time}>{listTime(c.created_at)}</Text>
      </View>
      <Text style={[styles.body, c.deleted && styles.deleted]}>{c.deleted ? 'This comment was deleted.' : c.body}</Text>
      {!c.deleted ? (
        <View style={styles.commentActions}>
          <PressableScale
            onPress={() => !c.mine && vote(c)}
            disabled={c.mine}
            accessibilityRole="button"
            accessibilityState={{ selected: c.voted }}
            accessibilityLabel={`Helpful, ${c.votes}`}
            style={[styles.helpful, c.voted && styles.helpfulOn]}>
            <ThumbsUpIcon size={14} weight={c.voted ? 'fill' : 'bold'} color={c.voted ? theme.onAccent : theme.textMuted} />
            <Text style={[styles.helpfulText, c.voted && styles.helpfulTextOn]}>{c.votes > 0 ? c.votes : 'Helpful'}</Text>
          </PressableScale>
          {!reply ? (
            <PressableScale onPress={() => setReplyTo(c)} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.action}>Reply</Text>
            </PressableScale>
          ) : null}
          <PressableScale onPress={() => setMenu(c)} accessibilityRole="button" accessibilityLabel="More" hitSlop={8}>
            <Text style={styles.action}>•••</Text>
          </PressableScale>
        </View>
      ) : null}
      {(c.replies ?? []).map((r) => renderComment(r, true))}
    </View>
  );

  return (
    <Screen style={styles.screen}>
      <BackHeader title={file.module.name} />
      <KeyboardFrame style={styles.flex}>
        <KeyboardScroll contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.stack}>
            <View style={styles.head}>
              <Text style={styles.code}>
                {file.module.code} · {file.module.name} · {category}
                {file.paper_year ? ` · ${file.paper_year}` : ''}
              </Text>
              <Text style={styles.title} accessibilityRole="header">
                {file.title}
              </Text>
              <Text style={styles.muted}>
                Shared by {file.mine ? 'you' : (file.uploader_name ?? 'a student')}
                {file.published_as === 'rep' ? ' (batch rep)' : ''}
                {file.scope === 'national' && file.institution ? ` · ${file.institution}` : ''}
                {file.scope === 'national' ? ' · all universities' : ''}
              </Text>
            </View>
            <View style={styles.buttons}>
              <View style={styles.flex}>
                <Button label="Open" onPress={open} />
              </View>
              <View style={styles.flex}>
                <Button label={kept ? 'Saved offline' : 'Save offline'} variant="quiet" disabled={kept} onPress={keep} />
              </View>
            </View>
            <FormMessage message={note} />

            <View style={styles.discussion}>
              <Text style={styles.sectionTitle} accessibilityRole="header">
                {pastPaper ? 'Answers and discussion' : 'Discussion'}
              </Text>
              {file.questions.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  <Chip label="All" active={question === null} onPress={() => setQuestion(null)} />
                  {file.questions.map((q) => (
                    <Chip
                      key={q.question}
                      label={`${q.question} (${q.count})`}
                      active={question === q.question}
                      onPress={() => setQuestion(q.question)}
                    />
                  ))}
                </ScrollView>
              ) : null}
              {comments === null ? (
                <ActivityIndicator color={theme.accentText} />
              ) : comments.length === 0 ? (
                <Text style={styles.muted}>
                  {pastPaper
                    ? 'No answers yet. Post how you solved a question: name it (Q3, Q4(b)) so others find it.'
                    : 'No comments yet. Ask about it, or say what helped.'}
                </Text>
              ) : (
                comments.map((c) => renderComment(c))
              )}
            </View>
          </View>
        </KeyboardScroll>

        <View style={styles.composer}>
          {replyTo ? (
            <View style={styles.replying}>
              <Text style={styles.muted} numberOfLines={1}>
                Replying to {replyTo.author?.name ?? 'a comment'}
              </Text>
              <PressableScale
                onPress={() => setReplyTo(null)}
                accessibilityRole="button"
                accessibilityLabel="Cancel reply"
                hitSlop={8}>
                <XIcon size={16} weight="bold" color={theme.textMuted} />
              </PressableScale>
            </View>
          ) : null}
          <View style={styles.inputRow}>
            {!replyTo && pastPaper ? (
              <TextInput
                value={draftQuestion || (question ?? '')}
                onChangeText={setDraftQuestion}
                placeholder="Q3"
                placeholderTextColor={theme.textMuted}
                maxLength={16}
                autoCapitalize="characters"
                style={[styles.input, styles.qInput]}
                accessibilityLabel="Which question (optional)"
              />
            ) : null}
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={replyTo ? 'Write a reply' : pastPaper ? 'Post an answer or ask about a question' : 'Write a comment'}
              placeholderTextColor={theme.textMuted}
              multiline
              maxLength={2000}
              style={[styles.input, styles.flex]}
              accessibilityLabel="Comment"
            />
            <Button label="Post" loading={posting} disabled={!draft.trim()} onPress={post} />
          </View>
        </View>
      </KeyboardFrame>

      <ActionSheet visible={!!menu} actions={menuActions} onClose={() => setMenu(null)} />
      <ReportSheet target={reporting} onClose={() => setReporting(null)} />
    </Screen>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const styles = useStyles();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </PressableScale>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  content: { padding: space.xl, paddingBottom: space.xxxl },
  stack: { gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  head: { gap: space.xs },
  code: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.accentText },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: t.text },
  muted: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.textMuted },
  buttons: { flexDirection: 'row', gap: space.md },
  discussion: { gap: space.md },
  sectionTitle: { fontFamily: fonts.display, fontSize: 20, color: t.text },
  chips: { gap: space.sm, paddingRight: space.xl },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: t.border,
    backgroundColor: t.surface,
  },
  chipActive: { backgroundColor: t.accent, borderColor: t.accent },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.text },
  chipTextActive: { color: t.onAccent },
  comment: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.md, gap: space.xs },
  reply: { backgroundColor: t.background, marginTop: space.sm, marginLeft: space.md },
  commentHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  author: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text, flexShrink: 1 },
  // A question label: the tint with Ink text (brand rule).
  qBadge: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: t.onAccentTint,
    backgroundColor: t.accentTint,
    paddingHorizontal: space.sm,
    paddingVertical: 1,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  time: { fontFamily: fonts.body, fontSize: 12, color: t.textMuted, marginLeft: 'auto' },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: t.text },
  deleted: { fontStyle: 'italic', color: t.textMuted },
  commentActions: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginTop: space.xs },
  helpful: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: t.border,
  },
  helpfulOn: { backgroundColor: t.accent, borderColor: t.accent },
  helpfulText: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.textMuted },
  helpfulTextOn: { color: t.onAccent },
  action: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.textMuted },
  composer: { borderTopWidth: 1, borderTopColor: t.border, padding: space.md, gap: space.sm, backgroundColor: t.background },
  replying: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.xs,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: {
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: t.surface,
    fontFamily: fonts.body,
    fontSize: 15,
    color: t.text,
  },
  qInput: { width: 64, textAlign: 'center' },
}));
