import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useChatState } from '@/lib/chat/store';
import type { ImageAttachment, Message } from '@/lib/chat/types';
import { mediaUrl } from '@/lib/media';
import { brand, createThemedStyles, fonts, radius, space } from '@/theme/tokens';

const WIDTH = 248;

// A photo in a chat, sized from its own proportions so nothing jumps as it loads. The tiny
// preview in the message shows blurred straight away; the photo replaces it when it arrives.
// Your own photos show from the phone's copy (no download), with upload progress while sending.
export function ImageMessage({
  message,
  image,
  onOpen,
  meta,
}: {
  message: Message;
  image: ImageAttachment;
  onOpen: () => void;
  meta: ReactNode;
}) {
  const styles = useStyles();
  const progress = useChatState((s) => s.uploads[message.id]);
  const [useRemote, setUseRemote] = useState(!image.local_uri);
  const remote = mediaUrl(image.path);
  const uri = useRemote ? remote : image.local_uri;

  const ratio = Math.min(Math.max(image.width / Math.max(image.height, 1), 0.62), 1.9);
  const height = Math.round(WIDTH / ratio);
  const sending = message.status === 'pending';

  return (
    <Pressable
      onPress={onOpen}
      disabled={!uri}
      accessibilityRole="imagebutton"
      accessibilityLabel={message.body ? `Photo: ${message.body}` : 'Photo'}
      style={[styles.frame, { width: WIDTH, height }]}>
      <Image
        source={uri ? { uri } : null}
        placeholder={image.thumb ? { uri: image.thumb } : null}
        placeholderContentFit="cover"
        contentFit="cover"
        transition={180}
        cachePolicy="memory-disk"
        recyclingKey={message.id}
        // The phone's copy can be cleared by the system; fall back to the stored photo.
        onError={() => !useRemote && remote && setUseRemote(true)}
        style={styles.image}
      />
      {sending ? (
        <View style={styles.progress}>
          {progress === undefined ? (
            <ActivityIndicator color={brand.white} />
          ) : (
            <Text style={styles.progressText}>{Math.round(progress * 100)}%</Text>
          )}
        </View>
      ) : null}
      {meta ? <View style={styles.metaPill}>{meta}</View> : null}
    </Pressable>
  );
}

const useStyles = createThemedStyles((t) => ({
  frame: { borderRadius: radius.lg - 4, overflow: 'hidden', backgroundColor: t.surface },
  image: { width: '100%', height: '100%' },
  progress: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    marginTop: -28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressText: { fontFamily: fonts.bodyBold, fontSize: 14, color: brand.white },
  // Time over the photo: on the bubble colour, so it reads on any picture.
  metaPill: {
    position: 'absolute',
    right: space.xs + 2,
    bottom: space.xs + 2,
    backgroundColor: t.bubbleTheirs,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingBottom: 1,
    opacity: 0.94,
  },
}));
