import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { XIcon } from 'phosphor-react-native/src/icons/X';

import { PressableScale } from '@/components/ui/pressable-scale';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

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
export function ModalScreen({ visible, title, onClose, action, children }: Props) {
  const theme = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
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
        <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {children}
        </KeyboardAvoidingView>
      </View>
    </Modal>
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
  // Red marks the thing to do; what sits on red is Ink.
  action: { minWidth: 64, height: 38, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: brand.red, alignItems: 'center', justifyContent: 'center' },
  actionDisabled: { backgroundColor: t.surface },
  actionText: { fontFamily: fonts.bodyBold, fontSize: 15, color: brand.ink },
  actionTextDisabled: { color: t.textMuted },
  body: { flex: 1 },
}));
