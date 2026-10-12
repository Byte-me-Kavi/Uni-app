import { Image, type ImageStyle } from 'expo-image';
import { memo, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FilePdfIcon } from 'phosphor-react-native/src/icons/FilePdf';
import { XIcon } from 'phosphor-react-native/src/icons/X';

import { PressableScale } from '@/components/ui/pressable-scale';
import { useSignedUrl } from '@/lib/chat/media-urls';
import { isPdf } from '@/lib/shop';
import { brand, createThemedStyles, fonts, space, useTheme } from '@/theme/tokens';

// Shop photos, size charts and slips live in the private bucket: each is read through a signed
// link (only for students who may see it), cached on the phone by its path. A photo still on the
// phone (a form before upload) shows from its file. A PDF slip shows as a PDF tile.
export const ShopImage = memo(function ShopImage({
  path,
  uri,
  style,
  fit = 'cover',
  pdf = false,
}: {
  path?: string | null;
  uri?: string | null;
  style?: StyleProp<ImageStyle>;
  fit?: 'cover' | 'contain';
  pdf?: boolean;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const document = pdf || isPdf(path);
  const signed = useSignedUrl(uri || document ? null : path);
  if (document) {
    return (
      <View style={[styles.image, styles.pdf, style as StyleProp<ViewStyle>]}>
        <FilePdfIcon size={26} weight="bold" color={theme.dangerText} />
        <Text style={styles.pdfText}>PDF</Text>
      </View>
    );
  }
  const source = uri ? { uri } : signed && path ? { uri: signed, cacheKey: path } : null;
  return <Image source={source} style={[styles.image, style]} contentFit={fit} cachePolicy="memory-disk" transition={120} />;
});

/** One photo full screen on black. */
export function PhotoViewer({
  photo,
  title,
  onClose,
}: {
  photo: { path?: string | null; uri?: string | null } | null;
  title?: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const signed = useSignedUrl(photo?.uri ? null : photo?.path);
  const uri = photo?.uri ?? signed;
  const [ready, setReady] = useState(false);
  return (
    <Modal visible={!!photo} animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[viewer.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={viewer.bar}>
          <PressableScale
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close photo"
            hitSlop={12}
            style={viewer.button}>
            <XIcon size={24} weight="bold" color={brand.white} />
          </PressableScale>
          <Text style={viewer.title} numberOfLines={1}>
            {title ?? ''}
          </Text>
          <View style={viewer.button} />
        </View>
        <View style={viewer.body}>
          {uri ? (
            <Image
              source={{ uri, cacheKey: photo?.uri ? undefined : (photo?.path ?? undefined) }}
              style={viewer.image}
              contentFit="contain"
              cachePolicy="memory-disk"
              onLoad={() => setReady(true)}
            />
          ) : null}
          {!ready ? <ActivityIndicator color={brand.white} style={viewer.spinner} /> : null}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = createThemedStyles((t) => ({
  image: { backgroundColor: t.surface },
  pdf: { alignItems: 'center', justifyContent: 'center', gap: 2, borderWidth: 1, borderColor: t.border },
  pdfText: { fontFamily: fonts.bodyBold, fontSize: 11, color: t.textMuted },
}));

// Always on black, in both themes.
const viewer = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, minHeight: 56, gap: space.md },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.bodyBold, fontSize: 16, color: brand.white },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  spinner: { position: 'absolute' },
});
