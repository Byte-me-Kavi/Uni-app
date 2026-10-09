import { useState, type Ref } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, fonts, radius, space } from '@/theme/tokens';

type Props = TextInputProps & {
  label: string;
  hint?: string;
  error?: string | null;
  /** Adds a Show/Hide toggle and hides the text by default. */
  secret?: boolean;
  ref?: Ref<TextInput>;
};

export function TextField({ label, hint, error, secret = false, ref, style, ...input }: Props) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(secret);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label} importantForAccessibility="no">
        {label}
      </Text>
      <View style={[styles.box, focused && styles.boxFocused, !!error && styles.boxError]}>
        <TextInput
          ref={ref}
          {...input}
          accessibilityLabel={label}
          accessibilityHint={hint}
          secureTextEntry={hidden}
          placeholderTextColor={colors.onInkMuted}
          selectionColor={colors.red}
          cursorColor={colors.red}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
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
            <Text style={styles.toggleText}>{hidden ? 'Show' : 'Hide'}</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.white },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inkBorder,
    backgroundColor: colors.inkRaised,
  },
  boxFocused: { borderColor: colors.white },
  boxError: { borderColor: colors.red },
  input: {
    flex: 1,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.white,
  },
  toggle: { paddingHorizontal: space.lg, paddingVertical: space.md },
  toggleText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.onInkMuted },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.onInkMuted },
  error: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.red },
});
