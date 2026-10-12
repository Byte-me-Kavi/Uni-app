import { router } from 'expo-router';
import { memo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChatCircleIcon } from 'phosphor-react-native/src/icons/ChatCircle';
import { DotsThreeVerticalIcon } from 'phosphor-react-native/src/icons/DotsThreeVertical';
import { FileIcon } from 'phosphor-react-native/src/icons/File';
import { FileDocIcon } from 'phosphor-react-native/src/icons/FileDoc';
import { FilePdfIcon } from 'phosphor-react-native/src/icons/FilePdf';
import { FilePptIcon } from 'phosphor-react-native/src/icons/FilePpt';
import { ImageIcon } from 'phosphor-react-native/src/icons/Image';

import { ReportSheet, type ReportTarget } from '@/components/chat/report-sheet';
import { Snippet } from '@/components/resources/snippet';
import { ActionSheet, type SheetAction } from '@/components/ui/action-sheet';
import { openShared, removeShared, SHARED_CATEGORIES, type SharedFile } from '@/lib/shared';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

function iconFor(mime: string) {
  if (mime === 'application/pdf') return FilePdfIcon;
  if (mime.includes('presentation')) return FilePptIcon;
  if (mime.includes('word')) return FileDocIcon;
  if (mime.startsWith('image/')) return ImageIcon;
  return FileIcon;
}

type Props = {
  file: SharedFile;
  /** Show the module code (lists across modules). */
  showModule?: boolean;
  onRemoved?: (id: string) => void;
};

// A file shared with the university: what it is, who shared it, open on tap, report or remove.
export const SharedRow = memo(function SharedRow({ file, showModule = false, onRemoved }: Props) {
  const theme = useTheme();
  const styles = useStyles();
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const Icon = iconFor(file.mime);
  const category = SHARED_CATEGORIES.find((c) => c.key === file.category)?.label ?? 'File';
  const meta = [
    showModule ? file.module.name : null,
    file.institution && file.scope === 'national' && !file.mine ? file.institution : null,
    file.paper_year ? String(file.paper_year) : category,
    file.mine ? 'You' : file.published_as === 'rep' ? `${file.uploader_name ?? 'A rep'} (batch rep)` : file.uploader_name,
  ]
    .filter(Boolean)
    .join(' · ');

  async function open() {
    setNote('Opening…');
    setNote(await openShared(file));
  }
  // Live files open their page (the file, and its discussion); waiting ones open straight away.
  const view = () => (file.status === 'live' ? router.push({ pathname: '/resource/[id]', params: { id: file.id } }) : open());

  const actions: SheetAction[] = file.mine
    ? [
        {
          label: 'Remove from the university library',
          destructive: true,
          onPress: async () => {
            const e = await removeShared(file.id);
            if (e) setNote(e);
            else onRemoved?.(file.id);
          },
        },
      ]
    : [{ label: 'Report this file', destructive: true, onPress: () => setReporting({ kind: 'resource', id: file.id, who: file.uploader_name ?? null, userId: null }) }];

  return (
    <View style={styles.row}>
      <Pressable
        onPress={view}
        onLongPress={() => setMenu(true)}
        accessibilityRole="button"
        accessibilityLabel={`${file.title}. ${meta}${file.comment_count ? `. ${file.comment_count} comments` : ''}`}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}>
        <View style={styles.tile}>
          <Icon size={24} color={theme.text} weight="duotone" />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={2}>
            {file.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
          {file.snippet ? <Snippet text={file.snippet} /> : null}
          {file.comment_count > 0 ? (
            <View style={styles.comments}>
              <ChatCircleIcon size={13} weight="bold" color={theme.textMuted} />
              <Text style={styles.meta}>{file.comment_count === 1 ? '1 comment' : `${file.comment_count} comments`}</Text>
            </View>
          ) : null}
          {file.status === 'pending' ? <Text style={styles.meta}>Being checked</Text> : null}
          {file.status === 'quarantined' || file.status === 'duplicate' ? (
            <Text style={styles.note}>Not shared: {file.check_reason ?? 'it did not pass its check.'}</Text>
          ) : null}
          {note ? <Text style={styles.note}>{note}</Text> : null}
        </View>
      </Pressable>
      <Pressable onPress={() => setMenu(true)} accessibilityRole="button" accessibilityLabel={`More for ${file.title}`} hitSlop={8} style={styles.more}>
        <DotsThreeVerticalIcon size={22} weight="bold" color={theme.textMuted} />
      </Pressable>
      <ActionSheet visible={menu} actions={actions} onClose={() => setMenu(false)} />
      <ReportSheet target={reporting} onClose={() => setReporting(null)} />
    </View>
  );
});

const useStyles = createThemedStyles((t) => ({
  row: { flexDirection: 'row', alignItems: 'center' },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm + 2, minHeight: 64 },
  pressed: { opacity: 0.7 },
  tile: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: t.background, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 20, color: t.text },
  meta: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  note: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: t.dangerText },
  more: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  comments: { flexDirection: 'row', alignItems: 'center', gap: 4 },
}));
