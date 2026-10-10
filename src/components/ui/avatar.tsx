import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import { mediaUrl } from '@/lib/media';
import { initials } from '@/lib/use-home';
import { createThemedStyles, fonts } from '@/theme/tokens';

type Props = {
  name: string;
  /** Profile photo path in the media bucket; initials show while it loads or when there is none. */
  path?: string | null;
  size?: number;
};

// A student's photo, or their initials. Same surface tone as inputs so initials read as part of
// the UI, not as decoration. The initials sit under the photo, so a slow network never shows an
// empty circle.
export function Avatar({ name, path, size = 40 }: Props) {
  const styles = useStyles();
  const uri = mediaUrl(path);
  return (
    <View
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Text style={[styles.text, { fontSize: size * 0.38 }]}>{initials(name)}</Text>
      {uri ? (
        <Image
          source={{ uri }}
          style={[styles.photo, { borderRadius: size / 2 }]}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={120}
          recyclingKey={uri}
        />
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  circle: {
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  text: { fontFamily: fonts.bodyBold, color: t.text },
  photo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
}));
