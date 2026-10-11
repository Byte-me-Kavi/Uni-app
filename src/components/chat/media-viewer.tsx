import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Modal, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ExportIcon } from 'phosphor-react-native/src/icons/Export';
import { XIcon } from 'phosphor-react-native/src/icons/X';

import { PressableScale } from '@/components/ui/pressable-scale';
import { clockTime } from '@/lib/chat/format';
import { shareFile } from '@/lib/chat/transfer';
import type { ImageAttachment, Message } from '@/lib/chat/types';
import { mediaUrl } from '@/lib/media';
import { brand, fonts, space } from '@/theme/tokens';

// A photo full screen on black, with who sent it and when, and a share button (which is also how
// you save it to the phone).
export function MediaViewer({ message, onClose }: { message: Message | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [sharing, setSharing] = useState(false);
  const image = message?.attachment as ImageAttachment | undefined;
  const remote = mediaUrl(image?.path);
  const uri = image?.local_uri ?? remote;

  async function share() {
    if (!image?.path || !remote) return;
    setSharing(true);
    await shareFile({ url: remote, path: image.path, name: 'photo.jpg', mime: 'image/jpeg', localUri: image.local_uri }).catch(() => {});
    setSharing(false);
  }

  return (
    <Modal visible={!!message} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.bar}>
          <PressableScale onPress={onClose} accessibilityRole="button" accessibilityLabel="Close photo" hitSlop={12} style={styles.button}>
            <XIcon size={24} weight="bold" color={brand.white} />
          </PressableScale>
          <View style={styles.who}>
            <Text style={styles.name} numberOfLines={1}>
              {message?.sender_name ?? 'You'}
            </Text>
            {message && message.status === 'sent' ? <Text style={styles.time}>{clockTime(message.created_at)}</Text> : null}
          </View>
          <PressableScale
            onPress={share}
            disabled={!image?.path || sharing}
            accessibilityRole="button"
            accessibilityLabel="Share or save photo"
            hitSlop={12}
            style={styles.button}>
            {sharing ? <ActivityIndicator color={brand.white} /> : <ExportIcon size={24} weight="bold" color={brand.white} />}
          </PressableScale>
        </View>
        {uri ? (
          <Image
            source={{ uri }}
            placeholder={image?.thumb ? { uri: image.thumb } : null}
            style={styles.image}
            contentFit="contain"
            cachePolicy="memory-disk"
            accessibilityLabel={message?.body ? `Photo: ${message.body}` : 'Photo'}
          />
        ) : null}
        {message?.body ? (
          <Text style={styles.caption} numberOfLines={4}>
            {message.body}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

// Always dark, whatever the theme: photos are judged against black.
const styles = {
  screen: { flex: 1, backgroundColor: '#000000' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.sm },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  who: { flex: 1 },
  name: { fontFamily: fonts.bodyBold, fontSize: 16, color: brand.white },
  time: { fontFamily: fonts.body, fontSize: 13, color: '#A3A3A3' },
  image: { flex: 1 },
  caption: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: brand.white, padding: space.lg },
} as const;
