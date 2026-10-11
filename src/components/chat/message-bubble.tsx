import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { ChecksIcon } from 'phosphor-react-native/src/icons/Checks';
import { ClockIcon } from 'phosphor-react-native/src/icons/Clock';
import { WarningCircleIcon } from 'phosphor-react-native/src/icons/WarningCircle';

import { ContactMessage } from '@/components/chat/contact-message';
import { FileMessage } from '@/components/chat/file-message';
import { ImageMessage } from '@/components/chat/image-message';
import { PollMessage } from '@/components/chat/poll-message';
import { Avatar } from '@/components/ui/avatar';
import { clockTime } from '@/lib/chat/format';
import { sticker } from '@/lib/chat/stickers';
import type { ContactAttachment, FileAttachment, ImageAttachment, Message, PollAttachment, StickerAttachment } from '@/lib/chat/types';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

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
  onOpenImage: (message: Message) => void;
};

// One message. Yours sit right on a tint of red (red means you); theirs sit left on the surface
// tone. Both use the normal text colour at reading size, and the time and ticks are quiet grey,
// turning red only for ✓✓, so the words are what you see first. Photos, documents, polls and
// contacts draw their own content inside the same bubble; stickers stand on their own.
// Memoised: a new message re-renders only its own bubble.
export const MessageBubble = memo(function MessageBubble(props: Props) {
  const { message, mine, showName, showAvatar, group, onRetry } = props;
  const styles = useStyles();
  const theme = useTheme();

  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs, showName && styles.runStart]}>
      {group && !mine ? (
        <View style={styles.avatarSlot}>
          {showAvatar ? <Avatar name={message.sender_name ?? '?'} path={message.sender_avatar} size={30} /> : null}
        </View>
      ) : null}
      <View style={[styles.column, mine && styles.columnMine]}>
        <Content {...props} />
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

function Content({ message, mine, showName, group, read, onOpenImage }: Props) {
  const styles = useStyles();
  const name =
    group && !mine && showName ? (
      <Text style={styles.name} numberOfLines={1}>
        {message.sender_name ?? 'Student'}
      </Text>
    ) : null;
  const meta = <Meta message={message} mine={mine} read={read} />;

  if (message.deleted) {
    return (
      <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
        {name}
        <Text style={[styles.body, styles.deleted]}>This message was deleted</Text>
        {meta}
      </View>
    );
  }

  if (message.kind === 'sticker') {
    const art = message.attachment ? sticker((message.attachment as StickerAttachment).pack, (message.attachment as StickerAttachment).id) : null;
    return (
      <View style={[styles.stickerWrap, mine && styles.columnMine]} accessible accessibilityLabel={`Sticker: ${art?.label ?? 'unknown'}`}>
        {name}
        {art ? <Image source={art.source} style={styles.sticker} contentFit="contain" /> : <Text style={styles.body}>Sticker</Text>}
        <View style={styles.stickerMeta}>{meta}</View>
      </View>
    );
  }

  if (message.kind === 'image' && message.attachment) {
    return (
      <View style={[styles.bubble, styles.mediaBubble, mine ? styles.mine : styles.theirs]}>
        {name ? <View style={styles.mediaName}>{name}</View> : null}
        <ImageMessage
          message={message}
          image={message.attachment as ImageAttachment}
          onOpen={() => onOpenImage(message)}
          meta={message.body ? null : meta}
        />
        {message.body ? (
          <View style={styles.caption}>
            <Text style={styles.body} selectable>
              {message.body}
            </Text>
            {meta}
          </View>
        ) : null}
      </View>
    );
  }

  const inner =
    message.kind === 'file' && message.attachment ? (
      <FileMessage message={message} file={message.attachment as FileAttachment} />
    ) : message.kind === 'poll' && message.attachment ? (
      <PollMessage message={message} poll={message.attachment as PollAttachment} />
    ) : message.kind === 'contact' && message.attachment ? (
      <ContactMessage contact={message.attachment as ContactAttachment} mine={mine} />
    ) : null;

  return (
    <View style={[styles.bubble, mine ? styles.mine : styles.theirs, inner && styles.wide]}>
      {name}
      {inner}
      {message.body && (message.kind === 'text' || message.kind === 'file') ? (
        <Text style={[styles.body, inner && styles.captionText]} selectable>
          {message.body}
        </Text>
      ) : null}
      {meta}
    </View>
  );
}

// Time and, on yours, the delivery state: a clock while sending, ✓ when the server has it, ✓✓ in
// red once they have read it (direct chats).
function Meta({ message, mine, read }: { message: Message; mine: boolean; read: boolean }) {
  const theme = useTheme();
  const styles = useStyles();
  const time = message.status === 'pending' ? '' : clockTime(message.created_at);
  const state =
    message.status === 'pending' ? 'Sending' : message.status === 'sent' ? (read ? 'Read' : 'Sent') : '';
  return (
    <View style={styles.meta} accessible accessibilityLabel={[time, mine ? state : ''].filter(Boolean).join(', ')}>
      {time ? <Text style={styles.time}>{time}</Text> : null}
      {mine && message.status === 'pending' ? <ClockIcon size={13} color={theme.textMuted} /> : null}
      {mine && message.status === 'sent' && !read ? <CheckIcon size={15} color={theme.textMuted} weight="bold" /> : null}
      {mine && message.status === 'sent' && read ? <ChecksIcon size={16} color={theme.tickRead} weight="bold" /> : null}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  row: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: space.md, marginTop: 2 },
  runStart: { marginTop: space.sm + 2 },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  avatarSlot: { width: 36 },
  column: { maxWidth: '82%', alignItems: 'flex-start' },
  columnMine: { alignItems: 'flex-end' },
  bubble: { paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.xs + 1, borderRadius: radius.lg },
  wide: { width: 272, maxWidth: '100%' },
  mine: { backgroundColor: t.bubbleMine, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: t.bubbleTheirs, borderBottomLeftRadius: 6 },
  mediaBubble: { padding: 4, paddingBottom: 4 },
  mediaName: { paddingHorizontal: space.sm, paddingTop: space.xs },
  caption: { paddingHorizontal: space.sm, paddingTop: space.xs + 2 },
  captionText: { marginTop: space.sm },
  name: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: t.text, marginBottom: 2 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: t.text },
  deleted: { fontStyle: 'italic', color: t.textMuted },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2, minHeight: 16 },
  time: { fontFamily: fonts.bodySemiBold, fontSize: 11.5, color: t.textMuted },
  stickerWrap: { alignItems: 'flex-start' },
  sticker: { width: 132, height: 132 },
  stickerMeta: {
    backgroundColor: t.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingTop: 1,
    marginTop: -6,
  },
  failed: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  failedText: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.dangerText, flexShrink: 1 },
}));
