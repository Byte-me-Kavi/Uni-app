import { router, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TextInput, View } from 'react-native';
import { PaperPlaneRightIcon } from 'phosphor-react-native/src/icons/PaperPlaneRight';
import { XIcon } from 'phosphor-react-native/src/icons/X';

import { ReportSheet, type ReportTarget } from '@/components/chat/report-sheet';
import { PostCard } from '@/components/feed/post-card';
import { ActionSheet, type SheetAction } from '@/components/ui/action-sheet';
import { Avatar } from '@/components/ui/avatar';
import { BackHeader } from '@/components/ui/back-header';
import { FormMessage } from '@/components/ui/form-message';
import { KeyboardFrame } from '@/components/ui/keyboard';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { addComment, ago, deleteComment, loadPost, peekPost, type FeedComment } from '@/lib/feed';
import { firstName } from '@/lib/use-home';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

const thread = (c: FeedComment) => c.parent_id ?? c.id;
const ordered = (list: FeedComment[]) => [...list].sort((a, b) => thread(a) - thread(b) || a.id - b.id);

// A post with its comments: oldest first, replies under their comment. The reply box sits above
// the keyboard; "Reply" on a comment says who you are answering, with a cross to stop.
export default function PostScreen() {
  const theme = useTheme();
  const styles = useStyles();
  const { id: raw, reply: replyParam } = useLocalSearchParams<{ id: string; reply?: string }>();
  const id = Number(raw);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(() => (peekPost(id) ? 'ready' : 'loading'));
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<FeedComment | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const input = useRef<TextInput>(null);
  const list = useRef<FlatList<FeedComment>>(null);

  useEffect(() => {
    let live = true;
    loadPost(id).then((r) => {
      if (!live) return;
      if (r.error !== null) {
        setError(r.error);
        setState('error');
        return;
      }
      setComments(ordered(r.data.comments));
      setMore(r.data.more);
      setState('ready');
      // Opened from "Answer": straight to the comment box.
      if (replyParam === '1') setTimeout(() => input.current?.focus(), 350);
    });
    return () => {
      live = false;
    };
  }, [id, replyParam]);

  async function loadMore() {
    const last = [...comments].reverse().find((c) => c.parent_id === null);
    if (!more || !last) return;
    const r = await loadPost(id, last.id);
    if (r.data) {
      const next = r.data.comments;
      setComments((all) => ordered([...all, ...next.filter((c) => !all.some((a) => a.id === c.id))]));
      setMore(r.data.more);
    }
  }

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    const r = await addComment(id, body, replyTo ? thread(replyTo) : null);
    setSending(false);
    if (r.error !== null) return setSendError(r.error);
    setText('');
    setReplyTo(null);
    setComments((all) => ordered([...all, r.data]));
    if (!r.data.parent_id) setTimeout(() => list.current?.scrollToEnd({ animated: true }), 120);
  }

  const reply = useCallback((c: FeedComment) => {
    setReplyTo(c);
    input.current?.focus();
  }, []);

  const removed = useCallback(
    async (c: FeedComment) => {
      const count = c.parent_id === null ? 1 + comments.filter((x) => x.parent_id === c.id).length : 1;
      const r = await deleteComment(id, c.id, count);
      if (!r.error) setComments((all) => all.filter((x) => x.id !== c.id && x.parent_id !== c.id));
    },
    [comments, id],
  );

  if (state !== 'ready' || !peekPost(id)) {
    return (
      <Screen style={styles.screen}>
        <BackHeader title="Post" />
        <View style={styles.center}>
          {state === 'error' ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} />}
        </View>
      </Screen>
    );
  }

  return (
    <Screen style={styles.screen}>
      <BackHeader title="Post" />
      <KeyboardFrame style={styles.flex}>
        <FlatList
          ref={list}
          style={styles.flex}
          contentContainerStyle={styles.content}
          data={comments}
          keyExtractor={(c) => String(c.id)}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.head}>
              <PostCard id={id} full />
              <Text style={styles.heading} accessibilityRole="header">
                {comments.length ? 'Comments' : 'No comments yet'}
              </Text>
            </View>
          }
          renderItem={({ item }) => <CommentRow comment={item} onReply={reply} onDelete={removed} />}
          ItemSeparatorComponent={Gap}
          ListFooterComponent={
            more ? (
              <PressableScale onPress={loadMore} accessibilityRole="button" style={styles.moreButton}>
                <Text style={styles.link}>Show more comments</Text>
              </PressableScale>
            ) : null
          }
        />
        <View style={styles.bar}>
          {replyTo ? (
            <View style={styles.replying}>
              <Text style={styles.replyingText} numberOfLines={1}>
                Replying to {firstName(replyTo.author.name)}
              </Text>
              <PressableScale
                onPress={() => setReplyTo(null)}
                accessibilityRole="button"
                accessibilityLabel="Stop replying"
                hitSlop={10}>
                <XIcon size={16} color={theme.textMuted} />
              </PressableScale>
            </View>
          ) : null}
          {sendError ? <FormMessage message={sendError} /> : null}
          <View style={styles.inputRow}>
            <TextInput
              ref={input}
              value={text}
              onChangeText={setText}
              placeholder={replyTo ? 'Write a reply' : peekPost(id)?.tag === 'question' ? 'Write an answer' : 'Write a comment'}
              placeholderTextColor={theme.textMuted}
              multiline
              maxLength={500}
              style={styles.input}
              accessibilityLabel={replyTo ? 'Reply' : 'Comment'}
            />
            <PressableScale
              onPress={send}
              disabled={!text.trim() || sending}
              accessibilityRole="button"
              accessibilityLabel="Send"
              hitSlop={6}
              style={[styles.send, { backgroundColor: theme.accent }, (!text.trim() || sending) && styles.disabled]}>
              {sending ? (
                <ActivityIndicator size="small" color={theme.onAccent} />
              ) : (
                <PaperPlaneRightIcon size={20} weight="fill" color={theme.onAccent} />
              )}
            </PressableScale>
          </View>
        </View>
      </KeyboardFrame>
    </Screen>
  );
}

const CommentRow = memo(function CommentRow({
  comment,
  onReply,
  onDelete,
}: {
  comment: FeedComment;
  onReply: (c: FeedComment) => void;
  onDelete: (c: FeedComment) => void;
}) {
  const styles = useStyles();
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const actions: SheetAction[] = [
    { label: 'Reply', onPress: () => onReply(comment) },
    ...(comment.can_delete ? [{ label: 'Delete comment', destructive: true, onPress: () => onDelete(comment) }] : []),
    ...(!comment.mine
      ? [
          {
            label: 'Report comment',
            destructive: true,
            onPress: () =>
              setReporting({ kind: 'post_comment', id: String(comment.id), who: comment.author.name, userId: comment.author.id }),
          },
        ]
      : []),
  ];
  return (
    <View style={[styles.comment, comment.parent_id !== null && styles.replyRow]}>
      <PressableScale
        onPress={() => router.push({ pathname: '/people/[id]', params: { id: comment.author.id } })}
        accessibilityRole="button"
        accessibilityLabel={comment.author.name}>
        <Avatar name={comment.author.name} path={comment.author.avatar_path} size={comment.parent_id ? 28 : 34} />
      </PressableScale>
      <View style={styles.flex}>
        <PressableScale onLongPress={() => setMenu(true)} scale={0.99} accessibilityHint="Long press for more options">
          <View style={styles.bubble}>
            <Text style={styles.commentName} numberOfLines={1}>
              {comment.author.name}
            </Text>
            <Text style={styles.commentBody} selectable>
              {comment.body}
            </Text>
          </View>
        </PressableScale>
        <View style={styles.commentActions}>
          <Text style={styles.time}>{ago(comment.created_at)}</Text>
          <PressableScale onPress={() => onReply(comment)} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.small}>Reply</Text>
          </PressableScale>
          <PressableScale onPress={() => setMenu(true)} accessibilityRole="button" accessibilityLabel="More options" hitSlop={8}>
            <Text style={styles.small}>More</Text>
          </PressableScale>
        </View>
      </View>
      <ActionSheet visible={menu} actions={actions} onClose={() => setMenu(false)} />
      <ReportSheet target={reporting} onClose={() => setReporting(null)} />
    </View>
  );
});

function Gap() {
  return <View style={{ height: space.md }} />;
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  content: {
    padding: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.xl,
    width: '100%',
    maxWidth: 608,
    alignSelf: 'center',
  },
  head: { gap: space.xl, marginBottom: space.lg },
  heading: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  comment: { flexDirection: 'row', gap: space.sm },
  replyRow: { marginLeft: 42 },
  bubble: {
    alignSelf: 'flex-start',
    backgroundColor: t.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  commentName: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  commentBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.text },
  commentActions: { flexDirection: 'row', gap: space.lg, paddingLeft: space.md, paddingTop: 4 },
  time: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  small: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.textMuted },
  link: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.accentText },
  moreButton: { paddingVertical: space.lg, alignItems: 'center' },
  bar: {
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderTopWidth: 1,
    borderTopColor: t.border,
    backgroundColor: t.background,
  },
  replying: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xs },
  replyingText: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 13, color: t.textMuted },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: {
    flex: 1,
    maxHeight: 120,
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
