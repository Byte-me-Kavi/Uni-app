import { Image } from 'expo-image';
import { FlatList, useWindowDimensions } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { STICKER_IDS, STICKERS, type StickerId } from '@/lib/chat/stickers';
import { createThemedStyles, space } from '@/theme/tokens';

const HEIGHT = 280;

// The sticker drawer, in the keyboard's place under the message box. One tap sends.
export function StickerTray({ onPick }: { onPick: (id: StickerId) => void }) {
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const columns = Math.max(4, Math.min(8, Math.floor(Math.min(width, 640) / 88)));
  const size = Math.floor((Math.min(width, 640) - space.md * 2) / columns);

  return (
    <FlatList
      key={columns}
      data={STICKER_IDS}
      numColumns={columns}
      keyExtractor={(id) => id}
      style={styles.tray}
      contentContainerStyle={styles.grid}
      renderItem={({ item }) => (
        <PressableScale
          onPress={() => onPick(item)}
          accessibilityRole="button"
          accessibilityLabel={`Send ${STICKERS[item].label} sticker`}
          style={{ width: size, height: size, padding: space.sm }}>
          <Image source={STICKERS[item].source} style={styles.sticker} contentFit="contain" />
        </PressableScale>
      )}
    />
  );
}

const useStyles = createThemedStyles((t) => ({
  tray: { height: HEIGHT, flexGrow: 0, backgroundColor: t.surface },
  grid: { padding: space.md, alignSelf: 'center' },
  sticker: { width: '100%', height: '100%' },
}));
