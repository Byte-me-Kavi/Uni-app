import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { CheckSquareIcon } from 'phosphor-react-native/src/icons/CheckSquare';
import { CircleIcon } from 'phosphor-react-native/src/icons/Circle';
import { SquareIcon } from 'phosphor-react-native/src/icons/Square';

import { votePoll } from '@/lib/chat/engine';
import { useChatState } from '@/lib/chat/store';
import type { Message, PollAttachment } from '@/lib/chat/types';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// A poll: tap an option to vote, tap it again to take the vote back. Bars show each option's
// share of voters and update live for everyone looking at the chat.
export function PollMessage({ message, poll }: { message: Message; poll: PollAttachment }) {
  const theme = useTheme();
  const styles = useStyles();
  const result = useChatState((s) => s.polls[message.id]);
  const [error, setError] = useState<string | null>(null);
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

  const Selected = poll.multiple ? CheckSquareIcon : CheckCircleIcon;
  const Unselected = poll.multiple ? SquareIcon : CircleIcon;

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
                <Selected size={22} color={theme.tickRead} weight="fill" />
              ) : (
                <Unselected size={22} color={theme.textMuted} />
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
    </View>
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
}));
