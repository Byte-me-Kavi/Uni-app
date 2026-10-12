import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import Animated, { Easing, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { XIcon } from 'phosphor-react-native/src/icons/X';

import { PressableScale } from '@/components/ui/pressable-scale';
import { SheetModal } from '@/components/ui/sheet-layer';
import { useKeyboardLift } from '@/lib/use-keyboard-lift';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Props = {
  visible: boolean;
  title: string;
  onClose: () => void;
  /** The main action, top right (Send). */
  action?: { label: string; onPress: () => void; disabled?: boolean };
  children: ReactNode;
};

// A full screen that slides up over the chat for one task (write a poll, pick a student, check a
// photo before sending): close on the left, the task's action on the right, like the phone's own
// compose screens.
//
// Drawn in the app's sheet layer, not in a Modal: on Android a Modal is a separate window that
// reports no keyboard events, so a caption box at the bottom stayed hidden behind the keyboard.
export function ModalScreen({ visible, title, onClose, action, children }: Props) {
  const theme = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const lift = useKeyboardLift(visible);
  return (
    <SheetModal visible={visible} onRequestClose={onClose}>
      <Animated.View
        entering={Platform.OS !== 'web' ? SlideInDown.duration(260).easing(Easing.bezier(0.32, 0.72, 0, 1)) : undefined}
        style={[styles.screen, { paddingTop: insets.top, paddingBottom: lift.overlap ? 0 : insets.bottom }]}
        accessibilityViewIsModal>
        <View style={styles.bar}>
          <PressableScale onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12} style={styles.close}>
            <XIcon size={22} weight="bold" color={theme.text} />
          </PressableScale>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
            {title}
          </Text>
          {action ? (
            <PressableScale
              onPress={action.onPress}
              disabled={action.disabled}
              accessibilityRole="button"
              accessibilityState={{ disabled: !!action.disabled }}
              style={[styles.action, action.disabled && styles.actionDisabled]}>
              <Text style={[styles.actionText, action.disabled && styles.actionTextDisabled]}>{action.label}</Text>
            </PressableScale>
          ) : (
            <View style={styles.close} />
          )}
        </View>
        <View ref={lift.ref} onLayout={lift.measure} style={[styles.body, Platform.OS === 'android' ? { paddingBottom: lift.overlap } : null]}>
          <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {children}
          </KeyboardAvoidingView>
        </View>
      </Animated.View>
    </SheetModal>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { flex: 1, backgroundColor: t.background },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 17, color: t.text, textAlign: 'center' },
  // The accent marks the thing to do; what sits on it is Ink.
  action: { minWidth: 64, height: 38, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  actionDisabled: { backgroundColor: t.surface },
  actionText: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.onAccent },
  actionTextDisabled: { color: t.textMuted },
  body: { flex: 1 },
}));
