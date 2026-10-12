import { Image } from 'expo-image';
import { Linking, Pressable, Text, View } from 'react-native';
import { XIcon } from 'phosphor-react-native/src/icons/X';

import type { LinkPreview } from '@/lib/chat/types';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// A link's preview: the page's picture, title, description and site. In a bubble it opens the
// link; above the message box (while writing) it has ✕ to send without it.
export function LinkCard({ link, onRemove }: { link: LinkPreview; onRemove?: () => void }) {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      onPress={() => !onRemove && /^https?:\/\//i.test(link.url) && Linking.openURL(link.url).catch(() => {})}
      disabled={!!onRemove}
      accessibilityRole={onRemove ? undefined : 'link'}
      accessibilityLabel={`${link.title ?? link.url}${link.site ? `, ${link.site}` : ''}`}
      style={[styles.card, onRemove && styles.composer]}>
      {link.image ? <Image source={{ uri: link.image }} style={onRemove ? styles.thumb : styles.image} contentFit="cover" cachePolicy="memory-disk" /> : null}
      <View style={styles.text}>
        {link.title ? (
          <Text style={styles.title} numberOfLines={2}>
            {link.title}
          </Text>
        ) : null}
        {link.description && !onRemove ? (
          <Text style={styles.description} numberOfLines={2}>
            {link.description}
          </Text>
        ) : null}
        <Text style={styles.site} numberOfLines={1}>
          {link.site ?? link.url}
        </Text>
      </View>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel="Send without preview" style={styles.remove}>
          <XIcon size={18} color={theme.textMuted} weight="bold" />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const useStyles = createThemedStyles((t) => ({
  card: { backgroundColor: t.background, borderRadius: radius.md - 2, overflow: 'hidden', marginBottom: space.xs + 2 },
  composer: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, marginBottom: 0 },
  // A fixed height: a page's picture never decides how tall the bubble is.
  image: { width: '100%', height: 136 },
  thumb: { width: 56, height: 56 },
  text: { flex: 1, padding: space.sm + 2, gap: 2 },
  title: { fontFamily: fonts.bodyBold, fontSize: 14.5, lineHeight: 19, color: t.text },
  description: { fontFamily: fonts.body, fontSize: 13, lineHeight: 17, color: t.textMuted },
  site: { fontFamily: fonts.body, fontSize: 12, color: t.textMuted },
  remove: { paddingHorizontal: space.md, alignSelf: 'stretch', justifyContent: 'center' },
}));
