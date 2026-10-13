import { Image } from 'expo-image';
import { memo } from 'react';
import { View } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { photoUrl, type FeedPhoto } from '@/lib/feed';
import { createThemedStyles, radius } from '@/theme/tokens';

const GAP = 3;

// A post's photos, laid out before they load (their sizes come with the post, so nothing jumps):
// one photo at its own shape (between 4:5 tall and 1.91:1 wide), two side by side, three as one
// large and two small, four in a grid. Only the feed copies load here; tapping opens the full one.
export const PostPhotos = memo(function PostPhotos({ photos, onOpen }: { photos: FeedPhoto[]; onOpen: (index: number) => void }) {
  const styles = useStyles();
  const tile = (index: number, style: object) => (
    <PressableScale
      key={photos[index].id}
      onPress={() => onOpen(index)}
      accessibilityRole="imagebutton"
      accessibilityLabel={photos.length > 1 ? `Photo ${index + 1} of ${photos.length}` : 'Photo'}
      accessibilityHint="Opens it full screen"
      scale={0.99}
      style={[styles.tile, style]}>
      <Image
        source={{ uri: photoUrl(photos[index].id) ?? undefined }}
        style={styles.image}
        contentFit="cover"
        cachePolicy="memory-disk"
        recyclingKey={photos[index].id}
        transition={120}
      />
    </PressableScale>
  );

  if (photos.length === 1) {
    const ratio = Math.min(1.91, Math.max(0.8, photos[0].w / photos[0].h));
    return tile(0, { width: '100%', aspectRatio: ratio });
  }
  if (photos.length === 2) {
    return (
      <View style={[styles.row, { aspectRatio: 1.6 }]}>
        {tile(0, styles.flex)}
        {tile(1, styles.flex)}
      </View>
    );
  }
  if (photos.length === 3) {
    return (
      <View style={[styles.row, { aspectRatio: 1.5 }]}>
        {tile(0, { flex: 2 })}
        <View style={[styles.flex, styles.column]}>
          {tile(1, styles.flex)}
          {tile(2, styles.flex)}
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.column, { aspectRatio: 1.25 }]}>
      <View style={[styles.flex, styles.row]}>
        {tile(0, styles.flex)}
        {tile(1, styles.flex)}
      </View>
      <View style={[styles.flex, styles.row]}>
        {tile(2, styles.flex)}
        {tile(3, styles.flex)}
      </View>
    </View>
  );
});

const useStyles = createThemedStyles((t) => ({
  row: { flexDirection: 'row', gap: GAP, width: '100%' },
  column: { gap: GAP, width: '100%' },
  flex: { flex: 1 },
  tile: { overflow: 'hidden', borderRadius: radius.md, backgroundColor: t.surface },
  image: { width: '100%', height: '100%' },
}));
