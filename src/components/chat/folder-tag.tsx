import { memo } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { FolderSimpleIcon } from 'phosphor-react-native/src/icons/FolderSimple';
import { ProhibitIcon } from 'phosphor-react-native/src/icons/Prohibit';

import { pressFolder, useFolder } from '@/lib/chat-folders';
import { useModuleColour } from '@/lib/module-colours';
import { categoryLabel } from '@/lib/library';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// Under a file, photo or link: where it is filed in Resources for this student ("Data Structures and
// Algorithms · Lecture slides", by name: students do not know modules by code); tap to change it. A file the check blocked says so instead. Nothing for items that are
// not in the student's library.
export const FolderTag = memo(function FolderTag({ messageId, containerStyle }: { messageId: string; containerStyle?: StyleProp<ViewStyle> }) {
  const folder = useFolder(messageId);
  if (!folder || (!folder.blocked && !folder.code)) return null;
  // The container (a photo's caption area) is drawn only when there is a tag to show.
  return containerStyle ? (
    <View style={containerStyle}>
      <Tag messageId={messageId} folder={folder} />
    </View>
  ) : (
    <Tag messageId={messageId} folder={folder} />
  );
});

function Tag({ messageId, folder }: { messageId: string; folder: NonNullable<ReturnType<typeof useFolder>> }) {
  const theme = useTheme();
  const styles = useStyles();
  const colour = useModuleColour(folder.module_id ?? 0);

  if (folder.blocked) {
    return (
      <View style={styles.blockedRow} accessible accessibilityLabel={`Blocked: ${folder.reason ?? 'this file did not pass its check.'}`}>
        <ProhibitIcon size={12} weight="bold" color={theme.dangerText} />
        <Text style={[styles.tag, styles.blocked]}>Blocked: {folder.reason ?? 'this file did not pass its check.'}</Text>
      </View>
    );
  }
  const label = `${folder.name ?? folder.code}${folder.category ? ` · ${categoryLabel(folder.category)}` : ''}`;
  return (
    <Pressable
      onPress={() => pressFolder(messageId)}
      accessibilityRole="button"
      accessibilityLabel={`Filed in Resources: ${label}. Change`}
      hitSlop={6}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
      <FolderSimpleIcon size={12} weight="fill" color={colour.fg} />
      <Text style={styles.tag} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const useStyles = createThemedStyles((t) => ({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: t.background,
    maxWidth: '100%',
  },
  pressed: { opacity: 0.6 },
  tag: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: t.textMuted, flexShrink: 1 },
  blockedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: space.xs },
  blocked: { color: t.dangerText },
}));
