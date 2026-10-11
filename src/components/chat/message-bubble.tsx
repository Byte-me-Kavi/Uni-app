import { Image } from 'expo-image';
import { memo, type ComponentType } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { ArrowBendUpRightIcon } from 'phosphor-react-native/src/icons/ArrowBendUpRight';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { ChecksIcon } from 'phosphor-react-native/src/icons/Checks';
import { ClockIcon } from 'phosphor-react-native/src/icons/Clock';
import { StarIcon } from 'phosphor-react-native/src/icons/Star';
import { WarningCircleIcon } from 'phosphor-react-native/src/icons/WarningCircle';

import { ContactMessage } from '@/components/chat/contact-message';
import { FileMessage } from '@/components/chat/file-message';
import { ImageMessage } from '@/components/chat/image-message';
import { LinkCard } from '@/components/chat/link-card';
import { PollMessage } from '@/components/chat/poll-message';
import { ReactionsRow } from '@/components/chat/reactions';
import { ReplyQuote } from '@/components/chat/reply-quote';
import { SwipeReply } from '@/components/chat/swipe-reply';
import { Avatar } from '@/components/ui/avatar';
import { emojiOnlyCount } from '@/lib/chat/emoji';
import { firstLink, useLinkPreview } from '@/lib/chat/link-previews';
import { clockTime } from '@/lib/chat/format';
import { STICKERS, stickerSource } from '@/lib/chat/stickers';
import type {
  ContactAttachment,
  FileAttachment,
  ImageAttachment,
  Message,
  PollAttachment,
  Reaction,
  StickerAttachment,
  VoiceAttachment,
} from '@/lib/chat/types';
import { voiceAvailable } from '@/lib/chat/voice';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// The voice player needs expo-audio, which builds made before it existed do not have.
const VoiceMessage: ComponentType<{ message: Message; voice: VoiceAttachment; mine: boolean }> | null = voiceAvailable()
  ? require('@/components/chat/voice-message').VoiceMessage
  : null;

type Props = {
  message: Message;
  mine: boolean;
  me: string | null;
  /** Groups: the sender's name above the first bubble of a run, the photo beside the last. */
  showName: boolean;
  showAvatar: boolean;
  group: boolean;
  /** Direct chats: the other student has the message (grey ✓✓) or has read it (blue ✓✓). */
  delivered: boolean;
  read: boolean;
  reactions: Reaction[] | undefined;
  starred: boolean;
  /** Briefly marked after jumping to it (from a reply, search, pin or star). */
  highlighted: boolean;
  onRetry: (message: Message) => void;
  /** A photo (opens the viewer) or a sticker (opens its sheet). */
  onOpenImage: (message: Message) => void;
  onLongPress: (message: Message) => void;
  onReply: (message: Message) => void;
  onJumpTo: (messageId: string) => void;
  onShowReactions: (message: Message) => void;
};

// One message. Yours sit right on a tint of the accent (it means you); theirs sit left on the surface
// tone. Both use the normal text colour at reading size, and the time and ticks are quiet grey,
// turning blue only for ✓✓ read, so the words are what you see first. Long-press for reactions and
// actions; swipe right to reply. Memoised: a change to one message re-renders only its bubble.
export const MessageBubble = memo(function MessageBubble(props: Props) {
  const { message, mine, showName, showAvatar, group, onRetry, onLongPress, onReply, reactions, highlighted } = props;
  const styles = useStyles();
  const theme = useTheme();
  const canAct = !message.deleted && message.status === 'sent';

  return (
    <View style={[highlighted && styles.highlight]}>
      <SwipeReply enabled={canAct} onReply={() => onReply(message)}>
        <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs, showName && styles.runStart]}>
          {group && !mine ? (
            <View style={styles.avatarSlot}>
              {showAvatar ? <Avatar name={message.sender_name ?? '?'} path={message.sender_avatar} size={30} /> : null}
            </View>
          ) : null}
          <View style={[styles.column, mine && styles.columnMine]}>
            <Pressable
              onLongPress={() => onLongPress(message)}
              delayLongPress={280}
              disabled={message.status === 'pending'}
              accessibilityHint={canAct ? 'Long press for reactions, reply, copy, forward and more' : undefined}>
              <Content {...props} />
            </Pressable>
            {reactions && reactions.length ? (
              <ReactionsRow reactions={reactions} mine={mine} onPress={() => props.onShowReactions(message)} />
            ) : null}
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
      </SwipeReply>
    </View>
  );
});

function Content(props: Props) {
  const { message, mine, me, showName, group, onOpenImage, onJumpTo } = props;
  const styles = useStyles();
  // A text with a link but no preview from the sender: fetch one (once per link, cached).
  const fetched = useLinkPreview(message.kind === 'text' && !message.link && !message.deleted ? firstLink(message.body) : null);
  const link = message.link ?? fetched;
  const theme = useTheme();
  const name =
    group && !mine && showName ? (
      <Text style={styles.name} numberOfLines={1}>
        {message.sender_name ?? 'Student'}
      </Text>
    ) : null;
  const meta = <Meta {...props} />;
  const forwarded = message.forwarded ? (
    <View style={styles.forwarded}>
      <ArrowBendUpRightIcon size={13} color={theme.textMuted} weight="bold" />
      <Text style={styles.forwardedText}>Forwarded</Text>
    </View>
  ) : null;
  const reply = message.reply ? <ReplyQuote reply={message.reply} me={me} onPress={() => onJumpTo(message.reply!.id)} /> : null;

  if (message.deleted) {
    return (
      <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
        {name}
        <Text style={[styles.body, styles.deleted]}>{mine ? 'You deleted this message' : 'This message was deleted'}</Text>
        {meta}
      </View>
    );
  }

  // Stickers and messages of only 1 to 3 emoji stand on their own, without a bubble.
  if (message.kind === 'sticker') {
    const attachment = message.attachment as StickerAttachment | null;
    const source = attachment ? stickerSource(attachment) : null;
    const label = attachment?.pack === 'fluent' ? (STICKERS as Record<string, { label: string }>)[attachment.id]?.label : null;
    return (
      <View style={[styles.free, mine && styles.columnMine]} accessible accessibilityLabel={`Sticker${label ? `: ${label}` : ''}`}>
        {name}
        {reply ? <View style={[styles.freeReply, mine ? styles.mine : styles.theirs]}>{reply}</View> : null}
        {source ? (
          // Tap for the sticker's sheet (add to favourites), as in WhatsApp.
          // Long press still opens the message menu (react, reply...): this inner touch target
          // would otherwise take the long press away from the bubble.
          <Pressable
            onPress={() => onOpenImage(message)}
            onLongPress={() => props.onLongPress(message)}
            delayLongPress={280}
            accessibilityRole="button"
            accessibilityHint="Tap to add to favourites, long press for reactions">
            <Image source={source} style={styles.sticker} contentFit="contain" autoplay />
          </Pressable>
        ) : (
          <Text style={styles.body}>Sticker</Text>
        )}
        <View style={styles.freeMeta}>{meta}</View>
      </View>
    );
  }
  const emojiCount = message.kind === 'text' && !message.reply && !message.forwarded ? emojiOnlyCount(message.body) : 0;
  if (emojiCount) {
    return (
      <View style={[styles.free, mine && styles.columnMine]}>
        {name}
        <Text style={[styles.bigEmoji, emojiCount === 1 ? styles.emoji1 : emojiCount === 2 ? styles.emoji2 : styles.emoji3]}>
          {message.body}
        </Text>
        <View style={styles.freeMeta}>{meta}</View>
      </View>
    );
  }

  if (message.kind === 'image' && message.attachment) {
    return (
      <View style={[styles.bubble, styles.mediaBubble, mine ? styles.mine : styles.theirs]}>
        {name || forwarded || reply ? (
          <View style={styles.mediaHead}>
            {name}
            {forwarded}
            {reply}
          </View>
        ) : null}
        <ImageMessage
          message={message}
          image={message.attachment as ImageAttachment}
          onOpen={() => onOpenImage(message)}
          meta={message.body ? null : meta}
        />
        {message.body ? (
          <View style={styles.caption}>
            <Body message={message} />
            {meta}
          </View>
        ) : null}
      </View>
    );
  }

  const inner =
    message.kind === 'file' && message.attachment ? (
      <FileMessage message={message} file={message.attachment as FileAttachment} />
    ) : message.kind === 'voice' && message.attachment ? (
      VoiceMessage ? (
        <VoiceMessage message={message} voice={message.attachment as VoiceAttachment} mine={mine} />
      ) : (
        <Text style={[styles.body, styles.deleted]}>Voice message. Update Uni Era to play it.</Text>
      )
    ) : message.kind === 'poll' && message.attachment ? (
      <PollMessage message={message} poll={message.attachment as PollAttachment} />
    ) : message.kind === 'contact' && message.attachment ? (
      <ContactMessage contact={message.attachment as ContactAttachment} mine={mine} />
    ) : null;

  return (
    // A preview card makes the bubble a fixed width, so the card (and its picture) has a size to
    // fill; left to size itself it could grow taller than the screen.
    <View style={[styles.bubble, mine ? styles.mine : styles.theirs, (inner || (link && message.kind === 'text')) && styles.wide]}>
      {name}
      {forwarded}
      {reply}
      {link && message.kind === 'text' ? <LinkCard link={link} /> : null}
      {inner}
      {message.body && (message.kind === 'text' || message.kind === 'file') ? (
        <View style={inner ? styles.captionGap : null}>
          <Body message={message} />
        </View>
      ) : null}
      {meta}
    </View>
  );
}

// Text, with links underlined and @mentions in bold.
function Body({ message }: { message: Message }) {
  const styles = useStyles();
  const text = message.body ?? '';
  const parts = text.split(/(https?:\/\/[^\s]+|www\.[^\s]+\.[a-z]{2,}[^\s]*|@[A-Z][^\s@]*(?: [A-Z][^\s@]*)?)/g);
  return (
    <Text style={styles.body} selectable>
      {parts.map((part, i) =>
        /^(https?:\/\/|www\.)/i.test(part) ? (
          // Tap to open in the browser.
          <Text
            key={i}
            style={styles.link}
            onPress={() => {
              const url = firstLink(part);
              if (url) Linking.openURL(url).catch(() => {});
            }}
            accessibilityRole="link">
            {part}
          </Text>
        ) : part.startsWith('@') && message.mentions?.length ? (
          <Text key={i} style={styles.mention}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

// Time and, on yours, the delivery state: a clock while sending, ✓ when the server has it, grey ✓✓
// when it reached their phone, blue ✓✓ once they have read it (direct chats).
function Meta({ message, mine, read, delivered, starred }: Props) {
  const theme = useTheme();
  const styles = useStyles();
  const time = message.status === 'pending' ? '' : clockTime(message.created_at);
  const state =
    message.status === 'pending' ? 'Sending' : message.status === 'sent' ? (read ? 'Read' : delivered ? 'Delivered' : 'Sent') : '';
  return (
    <View
      style={styles.meta}
      accessible
      accessibilityLabel={[starred ? 'Starred' : '', message.edited_at ? 'Edited' : '', time, mine ? state : ''].filter(Boolean).join(', ')}>
      {starred ? <StarIcon size={12} color={theme.textMuted} weight="fill" /> : null}
      {message.edited_at && !message.deleted ? <Text style={styles.time}>Edited</Text> : null}
      {time ? <Text style={styles.time}>{time}</Text> : null}
      {mine && !message.deleted && message.status === 'pending' ? <ClockIcon size={13} color={theme.textMuted} /> : null}
      {mine && !message.deleted && message.status === 'sent' && !read && !delivered ? (
        <CheckIcon size={15} color={theme.textMuted} weight="bold" />
      ) : null}
      {mine && !message.deleted && message.status === 'sent' && (read || delivered) ? (
        <ChecksIcon size={16} color={read ? theme.tickRead : theme.textMuted} weight="bold" />
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  highlight: { backgroundColor: t.surface },
  row: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: space.md, paddingTop: 2 },
  runStart: { paddingTop: space.sm + 2 },
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
  mediaHead: { paddingHorizontal: space.sm, paddingTop: space.xs, width: 248 },
  caption: { paddingHorizontal: space.sm, paddingTop: space.xs + 2, width: 248 },
  captionGap: { marginTop: space.sm },
  name: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: t.text, marginBottom: 2 },
  forwarded: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 },
  forwardedText: { fontFamily: fonts.body, fontStyle: 'italic', fontSize: 13, color: t.textMuted },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: t.text },
  link: { textDecorationLine: 'underline', color: t.text },
  mention: { fontFamily: fonts.bodyBold, color: t.tickRead },
  deleted: { fontStyle: 'italic', color: t.textMuted },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2, minHeight: 16 },
  time: { fontFamily: fonts.bodySemiBold, fontSize: 11.5, color: t.textMuted },
  free: { alignItems: 'flex-start' },
  freeReply: { borderRadius: radius.md, padding: 4, marginBottom: 4, maxWidth: 260 },
  sticker: { width: 132, height: 132 },
  bigEmoji: { color: t.text },
  emoji1: { fontSize: 52, lineHeight: 64 },
  emoji2: { fontSize: 44, lineHeight: 56 },
  emoji3: { fontSize: 38, lineHeight: 50 },
  freeMeta: {
    backgroundColor: t.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingTop: 1,
    marginTop: -4,
  },
  failed: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  failedText: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.dangerText, flexShrink: 1 },
}));
