import type { ReactNode } from 'react';
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, SlideInDown, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardLift } from '@/lib/use-keyboard-lift';

import { SheetModal } from '@/components/ui/sheet-layer';
import { createThemedStyles, fonts, radius, space } from '@/theme/tokens';

type Props = {
  visible: boolean;
  title?: string;
  onClose: () => void;
  /** Share of the screen's height the sheet may take (it is never taller than this). */
  height?: number;
  children: ReactNode;
};

// A sheet that rises from the bottom over part of the screen, as WhatsApp shows reactions and
// poll votes: the chat stays visible above it. Drag the top down, tap above it, or press back to
// close it.
export function BottomSheet({ visible, title, onClose, height = 0.55, children }: Props) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { height: screen } = useWindowDimensions();
  const animate = Platform.OS !== 'web';
  const drag = useSharedValue(0);
  // Android: a text box in the sheet (a group name, report details) stays above the keyboard.
  const lift = useKeyboardLift(visible);

  const pull = Gesture.Pan()
    .onUpdate((e) => {
      drag.set(Math.max(0, e.translationY));
    })
    .onEnd((e) => {
      if (drag.get() > 90 || e.velocityY > 900) runOnJS(onClose)();
      drag.set(withSpring(0, { damping: 22, stiffness: 260 }));
    });
  const dragged = useAnimatedStyle(() => ({ transform: [{ translateY: drag.get() }] }));

  return (
    <SheetModal visible={visible} onRequestClose={onClose}>
      <Animated.View ref={lift.ref} onLayout={lift.measure} entering={animate ? FadeIn.duration(160) : undefined} style={styles.backdrop}>
        <Pressable style={styles.fill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View
        entering={animate ? SlideInDown.duration(260).easing(Easing.bezier(0.32, 0.72, 0, 1)) : undefined}
        style={[
          styles.sheet,
          lift.overlap
            ? { bottom: lift.overlap, maxHeight: Math.min(screen * height, screen - lift.overlap - insets.top - 24) }
            : { maxHeight: screen * height + insets.bottom, paddingBottom: insets.bottom },
          dragged,
        ]}
        accessibilityViewIsModal>
        <GestureDetector gesture={pull}>
          <View style={styles.top}>
            <View style={styles.handle} />
            {title ? (
              <Text style={styles.title} accessibilityRole="header">
                {title}
              </Text>
            ) : null}
          </View>
        </GestureDetector>
        <View style={styles.body}>{children}</View>
      </Animated.View>
    </SheetModal>
  );
}

const useStyles = createThemedStyles((t) => ({
  fill: { flex: 1 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: t.scrim },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    backgroundColor: t.elevated,
    borderTopLeftRadius: radius.lg * 1.5,
    borderTopRightRadius: radius.lg * 1.5,
  },
  top: { alignItems: 'center', paddingTop: space.sm, paddingBottom: space.sm, gap: space.sm },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: t.border },
  title: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  body: { flexShrink: 1 },
}));
