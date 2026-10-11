import { Image } from 'expo-image';
import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { FileTextIcon } from 'phosphor-react-native/src/icons/FileText';
import { XIcon } from 'phosphor-react-native/src/icons/X';

import { ModalScreen } from '@/components/chat/modal-screen';
import { PressableScale } from '@/components/ui/pressable-scale';
import { documentLabel, formatBytes } from '@/lib/chat/attachments';
import type { FileAttachment, ImageAttachment } from '@/lib/chat/types';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

export type Pending = { kind: 'image'; photos: ImageAttachment[] } | { kind: 'file'; attachment: FileAttachment };

// A last look before photos or a document go, with room for a caption. Several photos show as a
// strip (tap ✕ to drop one); the caption goes with the first, as in WhatsApp.
export function AttachPreview({
  pending,
  onChange,
  onClose,
  onSend,
}: {
  pending: Pending | null;
  onChange: (next: Pending | null) => void;
  onClose: () => void;
  onSend: (caption: string) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const [caption, setCaption] = useState('');
  const [current, setCurrent] = useState(0);
  const photos = pending?.kind === 'image' ? pending.photos : [];
  const shown = photos[Math.min(current, photos.length - 1)];

  function send() {
    onSend(caption);
    setCaption('');
    setCurrent(0);
  }

  function drop(index: number) {
    const next = photos.filter((_, i) => i !== index);
    setCurrent(0);
    onChange(next.length ? { kind: 'image', photos: next } : null);
  }

  return (
    <ModalScreen
      visible={!!pending}
      title={pending?.kind === 'image' ? (photos.length > 1 ? `Send ${photos.length} photos` : 'Send photo') : 'Send document'}
      onClose={() => {
        setCaption('');
        setCurrent(0);
        onClose();
      }}
      action={{ label: 'Send', onPress: send }}>
      <View style={styles.stage}>
        {pending?.kind === 'image' && shown ? (
          <Image source={{ uri: shown.local_uri }} style={styles.photo} contentFit="contain" accessibilityLabel="Photo to send" />
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
      {photos.length > 1 ? (
        <ScrollView horizontal contentContainerStyle={styles.strip} showsHorizontalScrollIndicator={false}>
          {photos.map((photo, i) => (
            <PressableScale
              key={photo.local_uri}
              onPress={() => setCurrent(i)}
              accessibilityRole="button"
              accessibilityLabel={`Photo ${i + 1}`}
              style={[styles.thumbWrap, i === current && styles.thumbActive]}>
              <Image source={{ uri: photo.local_uri }} style={styles.thumb} contentFit="cover" />
              <PressableScale onPress={() => drop(i)} accessibilityRole="button" accessibilityLabel={`Remove photo ${i + 1}`} style={styles.drop}>
                <XIcon size={12} color={brand.white} weight="bold" />
              </PressableScale>
            </PressableScale>
          ))}
        </ScrollView>
      ) : null}
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
  strip: { gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm },
  thumbWrap: { width: 56, height: 56, borderRadius: radius.sm + 2, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  thumbActive: { borderColor: t.tickRead },
  thumb: { width: '100%', height: '100%' },
  drop: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
