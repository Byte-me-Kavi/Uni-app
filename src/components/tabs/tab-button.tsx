import type { ComponentType, Ref } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { TabTriggerSlotProps } from 'expo-router/ui';
import type { IconProps } from 'phosphor-react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { duration, EASE_OUT } from '@/theme/motion';
import { brand, createThemedStyles, fonts, useTheme } from '@/theme/tokens';

type Props = TabTriggerSlotProps & {
  label: string;
  Icon: ComponentType<IconProps>;
  ref?: Ref<View>;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// One tab in the bottom bar. The active tab is red (red means "you", here: where you are) with a
// filled icon; the rest are quiet. A small press-in confirms the tap.
export function TabButton({ label, Icon, isFocused, ref, ...props }: Props) {
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
      accessibilityLabel={label}
      accessibilityState={{ selected: !!isFocused }}
      style={[styles.button, pressStyle]}>
      <Icon size={25} weight={isFocused ? 'fill' : 'regular'} color={isFocused ? brand.red : theme.textMuted} />
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
}));
