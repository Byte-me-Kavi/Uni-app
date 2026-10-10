import { useState, type Ref } from 'react';
import { Platform, Pressable, TextInput, View, type TextStyle } from 'react-native';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { XCircleIcon } from 'phosphor-react-native/src/icons/XCircle';

import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onFocus: () => void;
  ref?: Ref<TextInput>;
};

// The pill's border already shows focus. Chromium draws its own focus ring with outline-style
// auto, which ignores outline-width, so web needs outline-style none (not in React Native's types).
const noFocusRing = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : null;

// The search box in the top bar. Opened many times a day, so focus changes the border at once
// with no animation.
export function SearchField({ value, onChangeText, onFocus, ref }: Props) {
  const theme = useTheme();
  const styles = useStyles();
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.box, focused && styles.boxFocused]}>
      <MagnifyingGlassIcon size={18} weight="bold" color={theme.textMuted} />
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => {
          setFocused(true);
          onFocus();
        }}
        onBlur={() => setFocused(false)}
        placeholder="Search students"
        placeholderTextColor={theme.textMuted}
        accessibilityLabel="Search students by name"
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        maxLength={100}
        selectionColor={brand.red}
        cursorColor={brand.red}
        style={[styles.input, noFocusRing]}
      />
      {value ? (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={10}>
          <XCircleIcon size={18} weight="fill" color={theme.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  box: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 42,
    paddingHorizontal: space.md + 2,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: t.surface,
    backgroundColor: t.surface,
  },
  boxFocused: { borderColor: t.focus, backgroundColor: t.surfaceFocused },
  input: {
    flex: 1,
    height: '100%',
    paddingVertical: 0,
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    color: t.text,
  },
}));
