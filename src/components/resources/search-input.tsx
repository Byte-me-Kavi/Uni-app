import { TextInput, View } from 'react-native';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';

import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// A compact search box for lists inside Resources.
export function SearchInput({ value, onChangeText, placeholder }: { value: string; onChangeText: (t: string) => void; placeholder: string }) {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.box}>
      <MagnifyingGlassIcon size={18} weight="bold" color={theme.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        style={styles.input}
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel={placeholder}
        clearButtonMode="while-editing"
      />
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: t.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: 44,
  },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: t.text, paddingVertical: space.sm },
}));
