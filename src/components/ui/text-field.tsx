import { useEffect, useState, type Ref } from 'react';
import { Platform, Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { duration, EASE_OUT } from '@/theme/motion';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Props = TextInputProps & {
  label: string;
  hint?: string;
  error?: string | null;
  /** Adds a Show/Hide toggle and hides the text by default. */
  secret?: boolean;
  ref?: Ref<TextInput>;
};

export function TextField({ label, hint, error, secret = false, ref, style, ...input }: Props) {
  const theme = useTheme();
  const styles = useStyles();
  const [hidden, setHidden] = useState(secret);
  // Reduced motion and web (pre-rendered pages): hints and errors simply appear.
  const still = useReducedMotion() || Platform.OS === 'web';
  const focus = useSharedValue(0);
  const invalid = useSharedValue(error ? 1 : 0);

  useEffect(() => {
    invalid.value = withTiming(error ? 1 : 0, { duration: duration.state, easing: EASE_OUT });
  }, [error, invalid]);

  // Border answers focus (Ink or white, by theme) and errors (red), so the state is visible
  // without reading.
  const { border, focus: focusColor, surface, surfaceFocused } = theme;
  const boxStyle = useAnimatedStyle(() => {
    const focused = interpolateColor(focus.value, [0, 1], [border, focusColor]);
    return {
      borderColor: interpolateColor(invalid.value, [0, 1], [focused, brand.danger]),
      backgroundColor: interpolateColor(focus.value, [0, 1], [surface, surfaceFocused]),
    };
  });

  return (
    <View style={styles.wrap}>
      <Text style={styles.label} importantForAccessibility="no">
        {label}
      </Text>
      <Animated.View style={[styles.box, boxStyle]}>
        <TextInput
          ref={ref}
          {...input}
          accessibilityLabel={label}
          accessibilityHint={hint}
          secureTextEntry={hidden}
          placeholderTextColor={theme.textMuted}
          selectionColor={theme.accent}
          cursorColor={theme.accent}
          onFocus={(e) => {
            focus.value = withTiming(1, { duration: duration.state, easing: EASE_OUT });
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            focus.value = withTiming(0, { duration: duration.state, easing: EASE_OUT });
            input.onBlur?.(e);
          }}
          style={[styles.input, style]}
        />
        {secret ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            hitSlop={12}
            style={styles.toggle}>
            <Text style={styles.toggleText} numberOfLines={1}>
              {hidden ? 'Show' : 'Hide'}
            </Text>
          </Pressable>
        ) : null}
      </Animated.View>
      {error ? (
        <Animated.Text
          key="error"
          entering={still ? undefined : FadeIn.duration(duration.state)}
          exiting={still ? undefined : FadeOut.duration(120)}
          style={styles.error}
          accessibilityLiveRegion="polite">
          {error}
        </Animated.Text>
      ) : hint ? (
        <Animated.Text key="hint" entering={still ? undefined : FadeIn.duration(duration.state)} style={styles.hint}>
          {hint}
        </Animated.Text>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  wrap: { gap: space.sm },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  input: {
    flex: 1,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    color: t.text,
  },
  toggle: { paddingHorizontal: space.lg, paddingVertical: space.md, minWidth: 68, alignItems: 'center' },
  toggleText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted },
  hint: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
  error: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 19, color: t.dangerText },
}));
