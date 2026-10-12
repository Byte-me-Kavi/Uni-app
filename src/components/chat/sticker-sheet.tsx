import { Image } from 'expo-image';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { StarIcon } from 'phosphor-react-native/src/icons/Star';

import { PressableScale } from '@/components/ui/pressable-scale';
import { setFavourite, useStickerLibrary } from '@/lib/chat/sticker-library';
import { stickerSource } from '@/lib/chat/stickers';
import type { StickerAttachment } from '@/lib/chat/types';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// Tapping a sticker in a chat, as in WhatsApp: the sticker large, and one tap to add it to (or
// take it out of) your favourites, which then sit in the sticker tray's Favourites tab.
export function StickerSheet({ sticker, onClose }: { sticker: StickerAttachment | null; onClose: () => void }) {
  const theme = useTheme();
  const styles = useStyles();
  const key = sticker ? `${sticker.pack}:${sticker.id}` : '';
  const favourite = useStickerLibrary((s) => s.items.some((i) => i.sticker === key && i.favourite));
  const [error, setError] = useState<string | null>(null);
  const source = sticker ? stickerSource(sticker) : null;

  async function toggle() {
    setError(null);
    const failed = await setFavourite(key, !favourite);
    if (failed) setError(failed);
  }

  return (
    <BottomSheet visible={!!sticker} onClose={onClose} height={0.6}>
      <View style={styles.body}>
        {source ? <Image source={source} style={styles.sticker} contentFit="contain" autoplay /> : null}
        <PressableScale
          onPress={toggle}
          accessibilityRole="button"
          accessibilityState={{ selected: favourite }}
          style={[styles.fav, favourite && styles.favOn]}>
          <StarIcon size={16} weight="fill" color={favourite ? theme.text : theme.onAccent} />
          <Text style={[styles.favText, favourite && styles.favTextOn]}>{favourite ? 'Favourite' : 'Add to favourites'}</Text>
        </PressableScale>
        {error ? <Text style={styles.error}>{error}</Text> : (
          <Text style={styles.note}>{favourite ? 'In your Favourites in the sticker tray.' : 'Favourites are the star tab in the sticker tray.'}</Text>
        )}
      </View>
    </BottomSheet>
  );
}

const useStyles = createThemedStyles((t) => ({
  // The accent marks the thing to do; what sits on it is Ink. Once added, it turns quiet.
  fav: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6, height: 36, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: t.accent },
  favOn: { backgroundColor: t.surface },
  favText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.onAccent },
  favTextOn: { color: t.text },
  body: { alignItems: 'stretch', gap: space.md, paddingHorizontal: space.xl, paddingBottom: space.xl },
  sticker: { width: 180, height: 180, alignSelf: 'center', marginVertical: space.sm },
  note: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted, textAlign: 'center' },
  error: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.dangerText, textAlign: 'center' },
}));
