import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { FileIcon } from 'phosphor-react-native/src/icons/File';
import { FileDocIcon } from 'phosphor-react-native/src/icons/FileDoc';
import { FilePdfIcon } from 'phosphor-react-native/src/icons/FilePdf';
import { FilePptIcon } from 'phosphor-react-native/src/icons/FilePpt';
import { FileTextIcon } from 'phosphor-react-native/src/icons/FileText';
import { FileXlsIcon } from 'phosphor-react-native/src/icons/FileXls';
import { FileZipIcon } from 'phosphor-react-native/src/icons/FileZip';

import { documentLabel, formatBytes } from '@/lib/chat/attachments';
import { signedUrl } from '@/lib/chat/media-urls';
import { useChatState } from '@/lib/chat/store';
import { openFile } from '@/lib/chat/transfer';
import type { FileAttachment, Message } from '@/lib/chat/types';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

const ICONS = {
  PDF: FilePdfIcon,
  Word: FileDocIcon,
  PowerPoint: FilePptIcon,
  Excel: FileXlsIcon,
  Zip: FileZipIcon,
  Text: FileTextIcon,
} as const;

// A document: type, name and size; tap to open it in the phone's viewer (downloaded once, then
// kept on the phone). Shows upload progress while sending.
export function FileMessage({ message, file }: { message: Message; file: FileAttachment }) {
  const theme = useTheme();
  const styles = useStyles();
  const progress = useChatState((s) => s.uploads[message.id]);
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const label = documentLabel(file.mime);
  const Icon = ICONS[label as keyof typeof ICONS] ?? FileIcon;
  const sending = message.status === 'pending';

  async function open() {
    if (!file.path) return;
    setFailed(false);
    setOpening(true);
    try {
      const url = (await signedUrl(file.path)) ?? '';
      if (!url && !file.local_uri) throw new Error('no link');
      await openFile({ url, path: file.path, name: file.name, mime: file.mime, localUri: file.local_uri });
    } catch {
      setFailed(true);
    } finally {
      setOpening(false);
    }
  }

  const detail = sending
    ? progress === undefined
      ? 'Waiting to upload'
      : `Uploading ${Math.round(progress * 100)}%`
    : failed
      ? 'Could not open. Tap to try again.'
      : `${label} · ${formatBytes(file.size)}`;

  return (
    <Pressable
      onPress={open}
      disabled={sending || !file.path || opening}
      accessibilityRole="button"
      accessibilityLabel={`${label} document, ${file.name}, ${formatBytes(file.size)}. ${sending ? detail : 'Open'}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.tile}>
        {opening ? <ActivityIndicator color={theme.text} /> : <Icon size={26} color={theme.text} weight="duotone" />}
      </View>
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={2}>
          {file.name}
        </Text>
        <Text style={[styles.detail, failed && styles.detailError]} numberOfLines={1}>
          {detail}
        </Text>
        {sending && progress !== undefined ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const useStyles = createThemedStyles((t) => ({
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  pressed: { opacity: 0.7 },
  tile: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: t.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 20, color: t.text },
  detail: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  detailError: { color: t.dangerText },
  track: { height: 4, borderRadius: 2, backgroundColor: t.border, overflow: 'hidden', marginTop: 4 },
  fill: { height: 4, backgroundColor: t.tickRead },
}));
