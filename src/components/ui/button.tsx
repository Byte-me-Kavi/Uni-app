import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { duration, EASE_OUT } from '@/theme/motion';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'quiet';
  loading?: boolean;
  disabled?: boolean;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Button({ label, onPress, variant = 'primary', loading = false, disabled = false }: Props) {
  const theme = useTheme();
  const styles = useStyles();
  const inactive = disabled || loading;
  const primary = variant === 'primary';
  const pressed = useSharedValue(0);

  // A 3% press-in under the thumb confirms the tap before anything else happens.
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.03 }],
  }));

  // Text on the accent is always Ink (brand rule), in both themes.
  const labelColor = primary ? theme.onAccent : theme.text;

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => {
        if (!inactive) pressed.value = withTiming(1, { duration: duration.press, easing: EASE_OUT });
      }}
      onPressOut={() => {
        pressed.value = withTiming(0, { duration: duration.release, easing: EASE_OUT });
      }}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      hitSlop={4}
      style={[styles.base, primary ? styles.primary : styles.quiet, disabled && styles.disabled, pressStyle]}>
      {/* The label keeps its space while loading so the button never changes size. */}
      <Text style={[styles.label, { color: labelColor }, loading && styles.hidden]} numberOfLines={1}>
        {label}
      </Text>
      {loading ? (
        <View style={styles.spinner} pointerEvents="none">
          <ActivityIndicator color={labelColor} />
        </View>
      ) : null}
    </AnimatedPressable>
  );
}

const useStyles = createThemedStyles((t) => ({
  base: {
    minHeight: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  primary: { backgroundColor: t.accent },
  quiet: { backgroundColor: 'transparent', borderWidth: 1, borderColor: t.border },
  disabled: { opacity: 0.45 },
  label: { fontFamily: fonts.bodyBold, fontSize: 17 },
  hidden: { opacity: 0 },
  spinner: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
}));
