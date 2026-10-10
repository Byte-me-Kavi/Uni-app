import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { createThemedStyles, fonts, radius, space } from '@/theme/tokens';

type Props = {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  /** Increment to shake the boxes, e.g. after a wrong code. */
  shakeKey?: number;
  disabled?: boolean;
};

// One real TextInput (so paste, autofill from the email and screen readers all work) drawn as
// separate boxes, with the box being typed into highlighted.
export function CodeInput({ value, onChange, length = 6, shakeKey = 0, disabled = false }: Props) {
  const styles = useStyles();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const offset = useSharedValue(0);

  // A short horizontal shake says "wrong code" without needing to read the message.
  useEffect(() => {
    if (shakeKey === 0) return;
    const step = (to: number) => withTiming(to, { duration: 50, easing: Easing.linear });
    offset.value = withSequence(step(-9), step(9), step(-6), step(6), step(-2), withTiming(0, { duration: 60 }));
  }, [shakeKey, offset]);

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
  const active = Math.min(value.length, length - 1);

  return (
    <Pressable onPress={() => inputRef.current?.focus()} accessible={false}>
      <Animated.View style={[styles.row, shakeStyle]}>
        {Array.from({ length }, (_, i) => {
          const isActive = focused && i === active;
          const filled = i < value.length;
          return (
            <View
              key={i}
              style={[styles.cell, filled && styles.cellFilled, isActive && styles.cellActive]}
              importantForAccessibility="no-hide-descendants">
              <Text style={styles.digit}>{value[i] ?? ''}</Text>
            </View>
          );
        })}
      </Animated.View>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={!disabled}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={length}
        autoFocus
        caretHidden
        accessibilityLabel={`${length}-digit code`}
        style={styles.hiddenInput}
      />
    </Pressable>
  );
}

const useStyles = createThemedStyles((t) => ({
  row: { flexDirection: 'row', gap: space.sm },
  cell: {
    flex: 1,
    aspectRatio: 0.82,
    maxHeight: 64,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: t.border,
    backgroundColor: t.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellFilled: { borderColor: t.borderFilled },
  cellActive: { borderColor: t.focus },
  digit: { fontFamily: fonts.bodyBold, fontSize: 24, color: t.text },
  // Kept on screen (not display:none) so the OS can still autofill and focus it.
  hiddenInput: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.01, color: 'transparent' },
}));
