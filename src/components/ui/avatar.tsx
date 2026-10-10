import { Text, View } from 'react-native';

import { initials } from '@/lib/use-home';
import { createThemedStyles, fonts } from '@/theme/tokens';

type Props = { name: string; size?: number };

// Initials until profile photos land. Same surface tone as inputs so it reads as part of the UI,
// not as a decoration.
export function Avatar({ name, size = 40 }: Props) {
  const styles = useStyles();
  return (
    <View
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Text style={[styles.text, { fontSize: size * 0.38 }]}>{initials(name)}</Text>
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  circle: {
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontFamily: fonts.bodyBold, color: t.text },
}));
