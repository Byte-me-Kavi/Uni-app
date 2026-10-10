import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { duration, EASE_OUT } from '@/theme/motion';

type Props = Omit<PressableProps, 'style' | 'children'> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** How far it presses in; 0.97 for small targets, 0.985 for large cards. */
  scale?: number;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Any tappable surface: shrinks slightly under the thumb so the tap is felt before anything else
// happens.
export function PressableScale({ children, style, scale = 0.97, onPressIn, onPressOut, ...rest }: Props) {
  const pressed = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: 1 - pressed.value * (1 - scale) }] }));

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        pressed.value = withTiming(1, { duration: duration.press, easing: EASE_OUT });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = withTiming(0, { duration: duration.release, easing: EASE_OUT });
        onPressOut?.(e);
      }}
      style={[style, animated]}>
      {children}
    </AnimatedPressable>
  );
}
