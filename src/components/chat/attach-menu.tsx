import { useRef, type ComponentType } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { IconProps } from 'phosphor-react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { SheetModal } from '@/components/ui/sheet-layer';
import { createThemedStyles, fonts, radius, space } from '@/theme/tokens';

export type AttachOption = {
  key: string;
  label: string;
  Icon: ComponentType<IconProps>;
  /** The circle's colour and the glyph on it (3:1 or better, as icons need). */
  tint: string;
  glyph: string;
  onPress: () => void;
};

// What "+" opens, as in WhatsApp: a grid of round, coloured icons with a word under each, so each
// choice is recognised at a glance instead of read down a list. Tap outside to close.
export function AttachMenu({ visible, options, onClose }: { visible: boolean; options: AttachOption[]; onClose: () => void }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const animate = Platform.OS !== 'web';
  // iOS cannot present a picker while this sheet is still closing, so there the choice waits for
  // onDismiss (an iOS-only event). Elsewhere it runs at once.
  const pending = useRef<(() => void) | null>(null);

  function choose(option: AttachOption) {
    if (Platform.OS === 'ios') pending.current = option.onPress;
    onClose();
    if (Platform.OS !== 'ios') option.onPress();
  }

  return (
    <SheetModal
      visible={visible}
      onRequestClose={onClose}
      onDismiss={() => {
        pending.current?.();
        pending.current = null;
      }}>
      <Animated.View entering={animate ? FadeIn.duration(160) : undefined} style={styles.backdrop}>
        <Pressable style={styles.fill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View
        entering={animate ? SlideInDown.duration(240).easing(Easing.bezier(0.32, 0.72, 0, 1)) : undefined}
        style={[styles.sheet, { paddingBottom: insets.bottom + space.xl }]}
        accessibilityViewIsModal>
        <View style={styles.handle} />
        <View style={styles.grid}>
          {options.map((option) => (
            <PressableScale
              key={option.key}
              onPress={() => choose(option)}
              scale={0.92}
              accessibilityRole="button"
              accessibilityLabel={option.label}
              style={styles.item}>
              <View style={[styles.circle, { backgroundColor: option.tint }]}>
                <option.Icon size={26} color={option.glyph} weight="fill" />
              </View>
              <Text style={styles.label} numberOfLines={1}>
                {option.label}
              </Text>
            </PressableScale>
          ))}
        </View>
      </Animated.View>
    </SheetModal>
  );
}

const useStyles = createThemedStyles((t) => ({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: t.scrim },
  fill: { flex: 1 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    backgroundColor: t.elevated,
    borderTopLeftRadius: radius.lg * 1.5,
    borderTopRightRadius: radius.lg * 1.5,
    paddingTop: space.sm,
    paddingHorizontal: space.lg,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: t.border, marginBottom: space.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.xl },
  item: { width: '33.333%', alignItems: 'center', gap: space.sm },
  circle: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: t.text },
}));
