import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { CameraIcon } from 'phosphor-react-native/src/icons/Camera';
import { XIcon } from 'phosphor-react-native/src/icons/X';

import { PhotoViewer, ShopImage } from '@/components/shop/shop-image';
import { ActionSheet } from '@/components/ui/action-sheet';
import { PressableScale } from '@/components/ui/pressable-scale';
import { openSlip, pickShopPhotos, pickSlipPdf, type FormPhoto, type ShopUploadKind } from '@/lib/shop';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

let next = 0;
const newKey = () => `p${Date.now()}-${next++}`;

// Photos on a shop form: thumbnails (tap to view, x to remove) and an Add tile that chooses from the
// gallery or takes a photo. Photos are shrunk on the phone; they upload when the form is sent.
export function PhotoField({
  label,
  hint,
  kind,
  max,
  photos,
  onChange,
  onError,
  allowPdf = false,
}: {
  label: string;
  hint?: string;
  kind: ShopUploadKind;
  max: number;
  photos: FormPhoto[];
  onChange: (photos: FormPhoto[]) => void;
  onError: (message: string) => void;
  /** A payment slip: may also be a PDF (the bank app's receipt). */
  allowPdf?: boolean;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const [choosing, setChoosing] = useState(false);
  const [viewing, setViewing] = useState<FormPhoto | null>(null);

  async function add(source: 'library' | 'camera') {
    const r = await pickShopPhotos(kind, source, max - photos.length);
    if (!r) return;
    if ('error' in r) return onError(r.error);
    onChange([...photos, ...r.uris.map((uri) => ({ key: newKey(), uri }))].slice(0, max));
  }

  async function addPdf() {
    const r = await pickSlipPdf();
    if (!r) return;
    if ('error' in r) return onError(r.error);
    onChange([...photos, { key: newKey(), uri: r.uri, name: r.name, pdf: true }].slice(0, max));
  }

  async function open(p: FormPhoto) {
    if (!p.pdf) return setViewing(p);
    const e = await openSlip(p);
    if (e) onError(e);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled">
        {photos.map((p, i) => (
          <View key={p.key}>
            <PressableScale
              onPress={() => open(p)}
              accessibilityRole="imagebutton"
              accessibilityLabel={p.pdf ? `PDF ${p.name ?? ''}` : `Photo ${i + 1}`}>
              <ShopImage uri={p.uri} path={p.path} pdf={p.pdf} style={styles.thumb} />
            </PressableScale>
            {i === 0 && max > 1 ? (
              <View style={styles.cover}>
                <Text style={styles.coverText}>Cover</Text>
              </View>
            ) : null}
            <PressableScale
              onPress={() => onChange(photos.filter((x) => x.key !== p.key))}
              accessibilityRole="button"
              accessibilityLabel={`Remove photo ${i + 1}`}
              hitSlop={8}
              style={styles.remove}>
              <XIcon size={14} weight="bold" color={theme.text} />
            </PressableScale>
          </View>
        ))}
        {photos.length < max ? (
          <PressableScale
            onPress={() => setChoosing(true)}
            accessibilityRole="button"
            accessibilityLabel={`Add ${label.toLowerCase()}`}
            style={[styles.thumb, styles.add]}>
            <CameraIcon size={24} weight="bold" color={theme.accentText} />
            <Text style={styles.addText}>{photos.length === 0 ? 'Add' : `${photos.length}/${max}`}</Text>
          </PressableScale>
        ) : null}
      </ScrollView>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      <ActionSheet
        visible={choosing}
        onClose={() => setChoosing(false)}
        actions={[
          { label: max - photos.length > 1 ? 'Choose photos' : 'Choose a photo', onPress: () => add('library') },
          { label: 'Take a photo', onPress: () => add('camera') },
          ...(allowPdf ? [{ label: 'Choose a PDF', onPress: addPdf }] : []),
        ]}
      />
      <PhotoViewer photo={viewing} title={label} onClose={() => setViewing(null)} />
    </View>
  );
}

const THUMB = 88;

const useStyles = createThemedStyles((t) => ({
  wrap: { gap: space.sm },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  hint: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
  row: { gap: space.sm, paddingTop: space.sm, paddingRight: space.xl },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.md },
  add: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: t.borderFilled,
    backgroundColor: t.surface,
  },
  addText: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.accentText },
  cover: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    backgroundColor: t.elevated,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  coverText: { fontFamily: fonts.bodyBold, fontSize: 11, color: t.text },
  remove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: t.elevated,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
