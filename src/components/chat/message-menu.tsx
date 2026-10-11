import { useRef } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';

import type { SheetAction } from '@/components/ui/action-sheet';
import { SheetModal } from '@/components/ui/sheet-layer';
import { QUICK_REACTIONS } from '@/lib/chat/emoji';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Props = {
  visible: boolean;
  /** Your current reaction, highlighted. */
  mine: string | null;
  canReact: boolean;
  actions: SheetAction[];
  onReact: (emoji: string) => void;
  onMoreEmoji: () => void;
  onClose: () => void;
};

// What a long press on a message opens, in WhatsApp's order: a row of quick reactions (and "+"
// for any emoji), then Reply, Copy, Forward, Star, Pin, Edit, Delete.
export function MessageMenu({ visible, mine, canReact, actions, onReact, onMoreEmoji, onClose }: Props) {
  const theme = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const animate = Platform.OS !== 'web';
  // iOS cannot present another sheet or picker while this one is still closing.
  const pending = useRef<(() => void) | null>(null);

  function run(action: () => void) {
    if (Platform.OS === 'ios') pending.current = action;
    onClose();
    if (Platform.OS !== 'ios') action();
  }

  return (
    <SheetModal
      // Never an empty menu: nothing to react to and nothing to do means nothing opens.
      visible={visible && (canReact || actions.length > 0)}
      onRequestClose={onClose}
      onDismiss={() => {
        pending.current?.();
        pending.current = null;
      }}>
      <Animated.View entering={animate ? FadeIn.duration(140) : undefined} style={styles.scrim}>
        <Pressable style={styles.fill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close menu" />
        <Animated.View
          entering={animate ? SlideInDown.duration(220).easing(Easing.out(Easing.cubic)) : undefined}
          style={[styles.sheet, { paddingBottom: insets.bottom + space.sm }]}>
          {canReact ? (
            <View style={styles.reactions} accessibilityRole="toolbar" accessibilityLabel="React">
              {QUICK_REACTIONS.map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => run(() => onReact(emoji))}
                  accessibilityRole="button"
                  accessibilityLabel={mine === emoji ? `Remove ${emoji} reaction` : `React ${emoji}`}
                  style={({ pressed }) => [styles.reaction, mine === emoji && styles.reactionMine, pressed && styles.pressed]}>
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => run(onMoreEmoji)}
                accessibilityRole="button"
                accessibilityLabel="More reactions"
                style={({ pressed }) => [styles.reaction, styles.more, pressed && styles.pressed]}>
                <PlusIcon size={20} color={theme.text} weight="bold" />
              </Pressable>
            </View>
          ) : null}
          <ScrollView style={styles.actions} bounces={false}>
            {actions.map((action, i) => (
              <Pressable
                key={action.label}
                onPress={() => run(action.onPress)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.action, i > 0 && styles.divider, pressed && styles.actionPressed]}>
                <Text style={[styles.actionText, action.destructive && styles.destructive]}>{action.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </SheetModal>
  );
}

const useStyles = createThemedStyles((t) => ({
  scrim: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  fill: { flex: 1 },
  sheet: {
    backgroundColor: t.elevated,
    borderTopLeftRadius: radius.lg + 4,
    borderTopRightRadius: radius.lg + 4,
    paddingTop: space.md,
    maxHeight: '80%',
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  reactions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  reaction: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  reactionMine: { backgroundColor: t.surface },
  more: { backgroundColor: t.surface },
  pressed: { transform: [{ scale: 0.9 }] },
  reactionEmoji: { fontSize: 28 },
  actions: { flexGrow: 0 },
  action: { paddingVertical: space.md + 2, paddingHorizontal: space.xl },
  actionPressed: { backgroundColor: t.elevatedPressed },
  divider: { borderTopWidth: 1, borderTopColor: t.border },
  actionText: { fontFamily: fonts.bodySemiBold, fontSize: 16.5, color: t.text },
  destructive: { color: t.dangerText },
}));
