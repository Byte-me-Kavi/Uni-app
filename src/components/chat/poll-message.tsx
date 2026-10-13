import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { CircleIcon } from 'phosphor-react-native/src/icons/Circle';

import { PeopleSkeleton } from '@/components/chat/reactions';
import { Avatar } from '@/components/ui/avatar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { votePoll } from '@/lib/chat/engine';
import { listTime } from '@/lib/chat/format';
import { useChatState } from '@/lib/chat/store';
import type { Message, PollAttachment } from '@/lib/chat/types';
import { supabase } from '@/lib/supabase';
import { onSignOut } from '@/lib/resets';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// A poll: tap an option to vote, tap it again to take the vote back. Bars show each option's
// share of voters and update live for everyone looking at the chat. "View votes" shows who chose
// what. Options are round in both kinds of poll, as in WhatsApp; the hint says how many to pick.
export function PollMessage({ message, poll }: { message: Message; poll: PollAttachment }) {
  const theme = useTheme();
  const styles = useStyles();
  const result = useChatState((s) => s.polls[message.id]);
  const [error, setError] = useState<string | null>(null);
  const [showVotes, setShowVotes] = useState(false);
  const counts = result?.counts ?? poll.options.map(() => 0);
  const mine = result?.mine ?? [];
  const voters = result?.voters ?? 0;
  const top = Math.max(...counts, 0);
  const canVote = message.status === 'sent';

  async function choose(index: number) {
    setError(null);
    const next = mine.includes(index)
      ? mine.filter((i) => i !== index)
      : poll.multiple
        ? [...mine, index].sort((a, b) => a - b)
        : [index];
    const failed = await votePoll(message.conversation_id, message.id, next, poll.options.length);
    if (failed) setError(failed);
  }

  return (
    <View style={styles.poll}>
      <Text style={styles.question}>{poll.question}</Text>
      <Text style={styles.hint}>{poll.multiple ? 'Select one or more' : 'Select one'}</Text>

      <View style={styles.options} accessibilityRole={poll.multiple ? undefined : 'radiogroup'}>
        {poll.options.map((option, i) => {
          const chosen = mine.includes(i);
          const share = voters > 0 ? counts[i] / voters : 0;
          return (
            <Pressable
              key={i}
              onPress={() => choose(i)}
              disabled={!canVote}
              accessibilityRole={poll.multiple ? 'checkbox' : 'radio'}
              accessibilityState={{ checked: chosen, disabled: !canVote }}
              accessibilityLabel={`${option}, ${counts[i]} ${counts[i] === 1 ? 'vote' : 'votes'}`}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
              {chosen ? (
                <CheckCircleIcon size={22} color={theme.tickRead} weight="fill" />
              ) : (
                <CircleIcon size={22} color={theme.textMuted} />
              )}
              <View style={styles.optionBody}>
                <View style={styles.optionLine}>
                  <Text style={[styles.optionText, chosen && styles.optionChosen]}>{option}</Text>
                  <Text style={styles.count}>{counts[i]}</Text>
                </View>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.fill,
                      { width: `${Math.round(share * 100)}%` },
                      counts[i] === top && top > 0 ? styles.fillLeading : null,
                    ]}
                  />
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.total}>
        {voters === 0 ? 'No votes yet' : `${voters} ${voters === 1 ? 'student' : 'students'} voted`}
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {voters > 0 && canVote ? (
        <Pressable
          onPress={() => setShowVotes(true)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.viewVotes, pressed && styles.pressed]}>
          <Text style={styles.viewVotesText}>View votes</Text>
        </Pressable>
      ) : null}
      {showVotes ? <PollVotes message={message} poll={poll} onClose={() => setShowVotes(false)} /> : null}
    </View>
  );
}

type Voter = { option: number; user_id: string; full_name: string; avatar_path: string | null; voted_at: string };

// The last list seen for each poll: "View votes" again shows it at once and refreshes behind.
const seen = new Map<string, Voter[]>();
onSignOut(() => seen.clear());

// Who voted for each option, newest vote first, in a sheet over the lower part of the chat. A plain
// ScrollView, not a SectionList: the poll lives inside the chat's message list, and a list opened
// from inside another list joins the outer one's scrolling instead of scrolling itself.
function PollVotes({ message, poll, onClose }: { message: Message; poll: PollAttachment; onClose: () => void }) {
  const styles = useStyles();
  const me = useChatState((s) => s.me);
  const result = useChatState((s) => s.polls[message.id]);
  const [rows, setRows] = useState<Voter[] | null>(() => seen.get(message.id) ?? null);
  const [failed, setFailed] = useState(false);

  // Loads again whenever the counts change, so the list matches the bars.
  useEffect(() => {
    let live = true;
    supabase
      .rpc('poll_voters', { p_conversation_id: message.conversation_id, p_message_id: message.id })
      .then(({ data, error }) => {
        if (!live) return;
        setFailed(!!error);
        if (error) return;
        seen.set(message.id, (data ?? []) as Voter[]);
        setRows((data ?? []) as Voter[]);
      });
    return () => {
      live = false;
    };
  }, [message.conversation_id, message.id, result]);

  const sections = poll.options.map((option, i) => {
    const people = (rows ?? []).filter((r) => r.option === i);
    return { title: option, count: people.length, data: people };
  });

  return (
    <BottomSheet visible title={poll.question} onClose={onClose} height={0.7}>
      {rows === null ? (
        failed ? (
          <Text style={styles.sheetNote}>Could not load the votes. Check your connection.</Text>
        ) : (
          <PeopleSkeleton count={Math.min(result?.voters || 3, 6)} />
        )
      ) : (
        <ScrollView contentContainerStyle={styles.sheetList}>
          {sections.map((section, i) => (
            <View key={i}>
              <View style={styles.sheetSection}>
                <Text style={styles.sheetOption}>{section.title}</Text>
                <Text style={styles.sheetCount}>
                  {section.count} {section.count === 1 ? 'vote' : 'votes'}
                </Text>
              </View>
              {section.data.map((item) => (
                <View key={item.user_id} style={styles.voter}>
                  <Avatar name={item.full_name} path={item.avatar_path} size={36} />
                  <Text style={styles.voterName} numberOfLines={1}>
                    {item.user_id === me ? 'You' : item.full_name}
                  </Text>
                  <Text style={styles.voterTime}>{listTime(item.voted_at)}</Text>
                </View>
              ))}
              {section.count === 0 ? <Text style={styles.noVotes}>No votes</Text> : null}
            </View>
          ))}
        </ScrollView>
      )}
    </BottomSheet>
  );
}

const useStyles = createThemedStyles((t) => ({
  poll: { gap: 2 },
  question: { fontFamily: fonts.bodyBold, fontSize: 16.5, lineHeight: 22, color: t.text },
  hint: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted, marginBottom: space.sm },
  options: { gap: space.sm },
  option: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingVertical: 2 },
  pressed: { opacity: 0.6 },
  optionBody: { flex: 1, gap: 5, paddingTop: 1 },
  optionLine: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  optionText: { flex: 1, fontFamily: fonts.body, fontSize: 15, lineHeight: 20, color: t.text },
  optionChosen: { fontFamily: fonts.bodyBold },
  count: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: t.border, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radius.pill, backgroundColor: t.textMuted },
  fillLeading: { backgroundColor: t.tickRead },
  total: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: t.textMuted, marginTop: space.sm },
  error: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.dangerText },
  viewVotes: { marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: t.border, alignItems: 'center' },
  viewVotesText: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: t.tickRead },
  sheetNote: { fontFamily: fonts.body, fontSize: 15, color: t.textMuted, textAlign: 'center', padding: space.xl },
  sheetList: { paddingHorizontal: space.lg, paddingBottom: space.lg },
  sheetSection: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
    paddingTop: space.lg,
    paddingBottom: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  sheetOption: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 15.5, color: t.text },
  sheetCount: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: t.textMuted },
  voter: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  voterName: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 15.5, color: t.text },
  voterTime: { fontFamily: fonts.body, fontSize: 12.5, color: t.textMuted },
  noVotes: { fontFamily: fonts.body, fontSize: 14, color: t.textMuted, paddingVertical: space.sm },
}));
