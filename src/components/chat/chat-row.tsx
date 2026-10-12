import { memo } from 'react';
import { Text, View } from 'react-native';
import { BellSlashIcon } from 'phosphor-react-native/src/icons/BellSlash';
import { BookOpenTextIcon } from 'phosphor-react-native/src/icons/BookOpenText';
import { ChalkboardTeacherIcon } from 'phosphor-react-native/src/icons/ChalkboardTeacher';
import { GraduationCapIcon } from 'phosphor-react-native/src/icons/GraduationCap';
import { PushPinIcon } from 'phosphor-react-native/src/icons/PushPin';
import { UsersThreeIcon } from 'phosphor-react-native/src/icons/UsersThree';

import { Avatar } from '@/components/ui/avatar';
import { PressableScale } from '@/components/ui/pressable-scale';
import { listTime } from '@/lib/chat/format';
import type { Chat } from '@/lib/chat/types';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// Group chats are told apart from people by a tile, not a face: batch (people), programme
// (graduation cap, national), course (open book, one module) and kuppi (a teacher at a board).
export function ChatIcon({ chat, size = 52 }: { chat: Chat; size?: number }) {
  const theme = useTheme();
  const styles = useStyles();
  if (chat.kind === 'direct') {
    return <Avatar name={chat.title ?? '?'} path={chat.other_avatar_path} size={size} />;
  }
  const Icon =
    chat.kind === 'programme'
      ? GraduationCapIcon
      : chat.kind === 'module'
        ? BookOpenTextIcon
        : chat.kind === 'kuppi'
          ? ChalkboardTeacherIcon
          : UsersThreeIcon;
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: size * 0.32 }]}>
      <Icon size={size * 0.48} weight="bold" color={theme.text} />
    </View>
  );
}

export function subtitleFor(chat: Chat) {
  if (chat.kind === 'programme') return 'Students from every university';
  if (chat.kind === 'cohort') return 'Your batch';
  if (chat.kind === 'module') return 'Course chat';
  if (chat.kind === 'kuppi') return 'Kuppi chat';
  return null;
}

type Props = {
  chat: Chat;
  me: string | null;
  onOpen: (chat: Chat) => void;
  /** Touch down: get the chat ready before the tap completes. */
  onWarm?: (chat: Chat) => void;
  /** Long press: pin, archive, mute. */
  onMenu?: (chat: Chat) => void;
};

// Memoised: a new message in one chat redraws that row only.
export const ChatRow = memo(function ChatRow({ chat, me, onOpen, onWarm, onMenu }: Props) {
  const theme = useTheme();
  const styles = useStyles();
  const unread = chat.unread > 0 && !chat.request;
  const who =
    chat.last_sender_id && chat.last_sender_id === me
      ? 'You: '
      : chat.kind !== 'direct' && chat.last_sender_name
        ? `${chat.last_sender_name.split(' ')[0]}: `
        : '';
  const preview = chat.last_message_preview
    ? `${who}${chat.last_message_preview}`
    : chat.request === 'outgoing'
      ? 'Request sent'
      : (subtitleFor(chat) ?? 'Say hello');

  return (
    <PressableScale
      onPress={() => onOpen(chat)}
      onPressIn={onWarm ? () => onWarm(chat) : undefined}
      onLongPress={onMenu ? () => onMenu(chat) : undefined}
      delayLongPress={350}
      accessibilityHint={onMenu ? 'Long press to pin, archive or mute' : undefined}
      scale={0.985}
      accessibilityRole="button"
      accessibilityLabel={`${chat.title}${chat.list_pinned_at ? ', pinned' : ''}. ${preview}${unread ? `. ${chat.unread} unread` : ''}`}
      style={styles.row}>
      <ChatIcon chat={chat} />
      <View style={styles.text}>
        <View style={styles.line}>
          <Text style={[styles.title, unread && styles.titleUnread]} numberOfLines={1}>
            {chat.title}
          </Text>
          {chat.last_message_at ? (
            <Text style={[styles.time, unread && styles.timeUnread]}>{listTime(chat.last_message_at)}</Text>
          ) : null}
        </View>
        <View style={styles.line}>
          <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
            {preview}
          </Text>
          {chat.muted ? <BellSlashIcon size={16} color={theme.textMuted} /> : null}
          {chat.list_pinned_at ? <PushPinIcon size={16} color={theme.textMuted} weight="fill" /> : null}
          {unread ? (
            // The accent marks something for you to do; what sits on it is Ink.
            <View style={[styles.badge, chat.muted && styles.badgeMuted]}>
              <Text style={styles.badgeText}>{chat.unread > 99 ? '99+' : chat.unread}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
});

const useStyles = createThemedStyles((t) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm + 2, paddingHorizontal: space.sm, borderRadius: radius.md },
  tile: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 16, color: t.text },
  titleUnread: { fontFamily: fonts.bodyBold },
  time: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  timeUnread: { fontFamily: fonts.bodyBold, color: t.text },
  preview: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
  previewUnread: { color: t.text },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: brand.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeMuted: { backgroundColor: t.borderFilled },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 12, color: brand.ink },
}));
