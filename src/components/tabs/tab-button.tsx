import type { ComponentType, Ref } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { TabTriggerSlotProps } from 'expo-router/ui';
import type { IconProps } from 'phosphor-react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { duration, EASE_OUT } from '@/theme/motion';
import { createThemedStyles, fonts, useTheme } from '@/theme/tokens';

type Props = TabTriggerSlotProps & {
  label: string;
  Icon: ComponentType<IconProps>;
  /** Unread count shown on the icon (Chats). */
  badge?: number;
  ref?: Ref<View>;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// One tab in the bottom bar. The active tab is the accent (it means "you", here: where you are) with a
// filled icon; the rest are quiet. A small press-in confirms the tap.
export function TabButton({ label, Icon, badge = 0, isFocused, ref, ...props }: Props) {
  const theme = useTheme();
  const styles = useStyles();
  const pressed = useSharedValue(0);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 - pressed.value * 0.06 }] }));

  return (
    <AnimatedPressable
      ref={ref}
      {...props}
      onPressIn={(e) => {
        pressed.value = withTiming(1, { duration: duration.press, easing: EASE_OUT });
        props.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = withTiming(0, { duration: duration.release, easing: EASE_OUT });
        props.onPressOut?.(e);
      }}
      accessibilityRole="tab"
      accessibilityLabel={badge > 0 ? `${label}, ${badge} unread` : label}
      accessibilityState={{ selected: !!isFocused }}
      style={[styles.button, pressStyle]}>
      <View>
        <Icon size={25} weight={isFocused ? 'fill' : 'regular'} color={isFocused ? theme.accentText : theme.textMuted} />
        {badge > 0 ? (
          // The accent with Ink text, like every unread count.
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.label, isFocused && styles.labelActive]} numberOfLines={1}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

const useStyles = createThemedStyles((t) => ({
  button: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingTop: 8, paddingBottom: 6, minHeight: 56 },
  label: { fontFamily: fonts.bodyBold, fontSize: 11.5, color: t.textMuted },
  labelActive: { color: t.text },
  badge: {
    position: 'absolute',
    top: -5,
    left: 15,
    minWidth: 19,
    height: 19,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: t.accent,
    borderWidth: 2,
    borderColor: t.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 10, lineHeight: 12, color: t.onAccent },
}));
