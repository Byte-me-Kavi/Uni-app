import { useRef } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SheetModal } from '@/components/ui/sheet-layer';
import { createThemedStyles, fonts, radius, space } from '@/theme/tokens';

export type SheetAction = {
  label: string;
  onPress: () => void;
  /** Removing or blocking: shown in the danger colour. */
  destructive?: boolean;
};

type Props = {
  visible: boolean;
  title?: string;
  message?: string;
  actions: SheetAction[];
  onClose: () => void;
};

// A sheet of choices from the bottom of the screen (change photo, confirm a block). React Native's
// Alert cannot show buttons on web, so the app uses this everywhere. It slides up from where the
// thumb is; on web, which is pre-rendered, and under reduced motion it simply appears.
export function ActionSheet({ visible, title, message, actions, onClose }: Props) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const animate = Platform.OS !== 'web';
  // iOS cannot present the photo picker while this sheet is still closing, so there the chosen
  // action waits for onDismiss (an iOS-only event). Elsewhere it runs at once.
  const pending = useRef<(() => void) | null>(null);

  function choose(action: SheetAction) {
    if (Platform.OS === 'ios') pending.current = action.onPress;
    onClose();
    if (Platform.OS !== 'ios') action.onPress();
  }

  return (
    <SheetModal
      visible={visible}
      onRequestClose={onClose}
      onDismiss={() => {
        pending.current?.();
        pending.current = null;
      }}>
      <Animated.View entering={animate ? FadeIn.duration(180) : undefined} style={styles.backdrop}>
        <Pressable style={styles.fill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View
        entering={animate ? SlideInDown.duration(260).easing(Easing.bezier(0.32, 0.72, 0, 1)) : undefined}
        style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}
        accessibilityViewIsModal>
        {title || message ? (
          <View style={styles.header}>
            {title ? <Text style={styles.title}>{title}</Text> : null}
            {message ? <Text style={styles.message}>{message}</Text> : null}
          </View>
        ) : null}
        <View style={styles.group}>
          {actions.map((action, i) => (
            <Pressable
              key={action.label}
              onPress={() => choose(action)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.action, i > 0 && styles.divider, pressed && styles.pressed]}>
              <Text style={[styles.actionText, action.destructive && styles.destructive]}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          style={({ pressed }) => [styles.group, styles.action, pressed && styles.pressed]}>
          <Text style={[styles.actionText, styles.cancel]}>Cancel</Text>
        </Pressable>
      </Animated.View>
    </SheetModal>
  );
}

const useStyles = createThemedStyles((t) => ({
  // Strong enough that the page behind reads as background, not as text competing with the sheet.
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: t.scrim },
  fill: { flex: 1 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.md,
    gap: space.sm,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  header: {
    backgroundColor: t.elevated,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.lg,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    gap: space.xs,
    alignItems: 'center',
  },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text, textAlign: 'center' },
  message: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.textMuted, textAlign: 'center' },
  group: { backgroundColor: t.elevated, borderWidth: 1, borderColor: t.border, borderRadius: radius.lg, overflow: 'hidden' },
  action: { minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  divider: { borderTopWidth: 1, borderTopColor: t.border },
  pressed: { backgroundColor: t.elevatedPressed },
  actionText: { fontFamily: fonts.bodySemiBold, fontSize: 17, color: t.text },
  destructive: { color: t.dangerText },
  cancel: { fontFamily: fonts.bodyBold },
}));
