import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { ChecksIcon } from 'phosphor-react-native/src/icons/Checks';
import { ClockIcon } from 'phosphor-react-native/src/icons/Clock';
import { WarningCircleIcon } from 'phosphor-react-native/src/icons/WarningCircle';

import { Avatar } from '@/components/ui/avatar';
import { clockTime } from '@/lib/chat/format';
import type { Message } from '@/lib/chat/types';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Props = {
  message: Message;
  mine: boolean;
  /** Groups: the sender's name above the first bubble of a run, the photo beside the last. */
  showName: boolean;
  showAvatar: boolean;
  group: boolean;
  /** Direct chats: the other student has read up to here (✓✓). */
  read: boolean;
  onRetry: (message: Message) => void;
};

// One message. Yours sit right on red (red means you; what sits on red is Ink); theirs sit left
// on the surface tone. Memoised: a new message re-renders only its own bubble.
export const MessageBubble = memo(function MessageBubble({ message, mine, showName, showAvatar, group, read, onRetry }: Props) {
  const theme = useTheme();
  const styles = useStyles();
  const time = message.status === 'pending' ? '' : clockTime(message.created_at);

  const bubble = (
    <View style={[styles.bubble, mine ? styles.mine : styles.theirs, message.status === 'failed' && styles.failedBubble]}>
      {group && !mine && showName ? (
        <Text style={styles.name} numberOfLines={1}>
          {message.sender_name ?? 'Student'}
        </Text>
      ) : null}
      <Text style={[styles.body, mine && styles.bodyMine, message.deleted && styles.deleted]} selectable>
        {message.deleted ? 'This message was deleted' : message.body}
      </Text>
      <View style={styles.meta}>
        {time ? <Text style={[styles.time, mine && styles.timeMine]}>{time}</Text> : null}
        {mine && message.status === 'pending' ? <ClockIcon size={13} color={brand.ink} weight="bold" /> : null}
        {mine && message.status === 'sent' && !read ? <CheckIcon size={14} color={brand.ink} weight="bold" /> : null}
        {mine && message.status === 'sent' && read ? <ChecksIcon size={15} color={brand.ink} weight="fill" /> : null}
      </View>
    </View>
  );

  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      {group && !mine ? (
        <View style={styles.avatarSlot}>
          {showAvatar ? <Avatar name={message.sender_name ?? '?'} path={message.sender_avatar} size={30} /> : null}
        </View>
      ) : null}
      <View style={[styles.column, mine && styles.columnMine]}>
        {bubble}
        {message.status === 'failed' ? (
          <Pressable
            onPress={() => onRetry(message)}
            accessibilityRole="button"
            accessibilityLabel={`Not sent. ${message.error ?? ''} Tap to try again`}
            style={styles.failed}>
            <WarningCircleIcon size={15} color={theme.dangerText} weight="bold" />
            <Text style={styles.failedText} numberOfLines={2}>
              {message.error ? `${message.error} ` : 'Not sent. '}Tap to retry
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

const useStyles = createThemedStyles((t) => ({
  row: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: space.md, marginTop: 3 },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  avatarSlot: { width: 34 },
  column: { maxWidth: '80%', alignItems: 'flex-start' },
  columnMine: { alignItems: 'flex-end' },
  bubble: { paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: 6, borderRadius: radius.lg },
  mine: { backgroundColor: brand.red, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: t.surface, borderBottomLeftRadius: 6 },
  failedBubble: { opacity: 0.6 },
  name: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.textMuted, marginBottom: 2 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: t.text },
  bodyMine: { color: brand.ink },
  deleted: { fontStyle: 'italic', color: t.textMuted },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3, marginTop: 1, minHeight: 14 },
  time: { fontFamily: fonts.body, fontSize: 11, color: t.textMuted },
  timeMine: { color: brand.ink, opacity: 0.75 },
  failed: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  failedText: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.dangerText, flexShrink: 1 },
}));
