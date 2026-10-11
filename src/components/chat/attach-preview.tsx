import { Image } from 'expo-image';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { FileTextIcon } from 'phosphor-react-native/src/icons/FileText';

import { ModalScreen } from '@/components/chat/modal-screen';
import { documentLabel, formatBytes } from '@/lib/chat/attachments';
import type { FileAttachment, ImageAttachment } from '@/lib/chat/types';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

export type Pending = { kind: 'image'; attachment: ImageAttachment } | { kind: 'file'; attachment: FileAttachment };

// A last look at a photo or document before it goes, with room for a caption.
export function AttachPreview({
  pending,
  onClose,
  onSend,
}: {
  pending: Pending | null;
  onClose: () => void;
  onSend: (caption: string) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const [caption, setCaption] = useState('');

  function send() {
    onSend(caption);
    setCaption('');
  }

  return (
    <ModalScreen
      visible={!!pending}
      title={pending?.kind === 'image' ? 'Send photo' : 'Send document'}
      onClose={() => {
        setCaption('');
        onClose();
      }}
      action={{ label: 'Send', onPress: send }}>
      <View style={styles.stage}>
        {pending?.kind === 'image' ? (
          <Image source={{ uri: pending.attachment.local_uri }} style={styles.photo} contentFit="contain" accessibilityLabel="Photo to send" />
        ) : pending?.kind === 'file' ? (
          <View style={styles.doc}>
            <View style={styles.docTile}>
              <FileTextIcon size={40} color={theme.text} weight="duotone" />
            </View>
            <Text style={styles.docName} numberOfLines={3}>
              {pending.attachment.name}
            </Text>
            <Text style={styles.docDetail}>
              {documentLabel(pending.attachment.mime)} · {formatBytes(pending.attachment.size)}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.captionBar}>
        <TextInput
          value={caption}
          onChangeText={setCaption}
          placeholder="Add a caption"
          placeholderTextColor={theme.textMuted}
          maxLength={1024}
          multiline
          style={styles.caption}
          selectionColor={brand.red}
          cursorColor={brand.red}
          accessibilityLabel="Caption"
        />
      </View>
    </ModalScreen>
  );
}

const useStyles = createThemedStyles((t) => ({
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  photo: { width: '100%', height: '100%', borderRadius: radius.md },
  doc: { alignItems: 'center', gap: space.sm, paddingHorizontal: space.xl, maxWidth: 420 },
  docTile: { width: 88, height: 88, borderRadius: radius.lg, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' },
  docName: { fontFamily: fonts.bodyBold, fontSize: 18, lineHeight: 24, color: t.text, textAlign: 'center', marginTop: space.sm },
  docDetail: { fontFamily: fonts.body, fontSize: 15, color: t.textMuted },
  captionBar: { padding: space.md, borderTopWidth: 1, borderTopColor: t.border },
  caption: {
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: space.lg,
    paddingTop: 11,
    paddingBottom: 11,
    borderRadius: 22,
    backgroundColor: t.surface,
    fontFamily: fonts.body,
    fontSize: 16,
    color: t.text,
  },
}));
