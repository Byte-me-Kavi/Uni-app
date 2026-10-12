import { Image } from 'expo-image';
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { DotsThreeVerticalIcon } from 'phosphor-react-native/src/icons/DotsThreeVertical';
import { FileIcon } from 'phosphor-react-native/src/icons/File';
import { FileDocIcon } from 'phosphor-react-native/src/icons/FileDoc';
import { FilePdfIcon } from 'phosphor-react-native/src/icons/FilePdf';
import { FilePptIcon } from 'phosphor-react-native/src/icons/FilePpt';
import { LinkSimpleIcon } from 'phosphor-react-native/src/icons/LinkSimple';
import { PushPinIcon } from 'phosphor-react-native/src/icons/PushPin';
import { YoutubeLogoIcon } from 'phosphor-react-native/src/icons/YoutubeLogo';

import { Snippet } from '@/components/resources/snippet';
import { documentLabel } from '@/lib/chat/attachments';
import { itemSource, type LibraryItem } from '@/lib/library';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Props = {
  item: LibraryItem;
  onOpen: (item: LibraryItem) => void;
  onMore: (item: LibraryItem) => void;
  /** Shown under the source line, e.g. "Opening…" or an error. */
  note?: string | null;
};

function iconFor(item: LibraryItem) {
  if (item.kind === 'link') return item.category === 'videos' ? YoutubeLogoIcon : LinkSimpleIcon;
  const label = documentLabel(item.mime ?? '');
  return label === 'PDF' ? FilePdfIcon : label === 'PowerPoint' ? FilePptIcon : label === 'Word' ? FileDocIcon : FileIcon;
}

// One file, photo or link in a module folder: what it is, where it came from, and a menu.
export const ItemRow = memo(function ItemRow({ item, onOpen, onMore, note }: Props) {
  const theme = useTheme();
  const styles = useStyles();
  const Icon = iconFor(item);
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => onOpen(item)}
        onLongPress={() => onMore(item)}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}. ${itemSource(item)}. Open`}
        accessibilityHint="Long press for more"
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}>
        <View style={styles.tile}>
          {item.kind === 'image' && item.thumb ? (
            <Image source={{ uri: item.thumb }} style={styles.thumb} contentFit="cover" blurRadius={2} />
          ) : (
            <Icon size={24} color={theme.text} weight="duotone" />
          )}
        </View>
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {item.paper_year ? `${item.paper_year} · ` : ''}
            {itemSource(item)}
          </Text>
          {item.snippet ? <Snippet text={item.snippet} /> : null}
          {note ? <Text style={styles.note}>{note}</Text> : null}
        </View>
        {item.pinned ? <PushPinIcon size={16} weight="fill" color={theme.textMuted} /> : null}
      </Pressable>
      <Pressable
        onPress={() => onMore(item)}
        accessibilityRole="button"
        accessibilityLabel={`More for ${item.title}`}
        hitSlop={8}
        style={styles.more}>
        <DotsThreeVerticalIcon size={22} weight="bold" color={theme.textMuted} />
      </Pressable>
    </View>
  );
});

const useStyles = createThemedStyles((t) => ({
  row: { flexDirection: 'row', alignItems: 'center' },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm + 2, minHeight: 64 },
  pressed: { opacity: 0.7 },
  tile: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: t.background,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumb: { width: 44, height: 44 },
  copy: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 20, color: t.text },
  meta: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  note: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: t.dangerText },
  more: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
}));
