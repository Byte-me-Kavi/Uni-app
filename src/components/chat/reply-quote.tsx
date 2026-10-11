import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';
import { XIcon } from 'phosphor-react-native/src/icons/X';

import { stickerSource } from '@/lib/chat/stickers';
import type { ReplySnapshot } from '@/lib/chat/types';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// A quoted message: inside a reply bubble (tap to jump to the original), above the message box
// while you write a reply (with ✕), and as the pinned bar.
export function ReplyQuote({
  reply,
  me,
  onPress,
  onCancel,
  label,
}: {
  reply: ReplySnapshot;
  me: string | null;
  onPress?: () => void;
  onCancel?: () => void;
  label?: string;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const who = label ?? (reply.sender_id === me || !reply.sender_name ? 'You' : reply.sender_name);
  const art = reply.sticker ? stickerSource(reply.sticker) : null;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label ? label : `Replying to ${who}`}: ${reply.text ?? ''}`}
      style={[styles.quote, onCancel && styles.composer]}>
      <View style={styles.bar} />
      <View style={styles.text}>
        <Text style={styles.who} numberOfLines={1}>
          {who}
        </Text>
        <Text style={styles.body} numberOfLines={2}>
          {reply.text || ' '}
        </Text>
      </View>
      {reply.thumb ? <Image source={{ uri: reply.thumb }} style={styles.thumb} contentFit="cover" /> : null}
      {art ? <Image source={art} style={styles.thumb} contentFit="contain" /> : null}
      {onCancel ? (
        <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel" style={styles.cancel}>
          <XIcon size={18} color={theme.textMuted} weight="bold" />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const useStyles = createThemedStyles((t) => ({
  quote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: t.background,
    borderRadius: radius.md - 2,
    overflow: 'hidden',
    marginBottom: space.xs + 2,
    minHeight: 44,
  },
  composer: { marginBottom: 0, backgroundColor: t.surface },
  bar: { width: 4, alignSelf: 'stretch', backgroundColor: t.tickRead },
  text: { flex: 1, paddingVertical: space.xs + 2 },
  who: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.tickRead },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
  thumb: { width: 44, height: 44 },
  cancel: { paddingHorizontal: space.md, alignSelf: 'stretch', justifyContent: 'center' },
}));
