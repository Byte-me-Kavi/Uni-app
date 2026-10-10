import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { CaretLeftIcon } from 'phosphor-react-native/src/icons/CaretLeft';

import { PressableScale } from '@/components/ui/pressable-scale';
import { createThemedStyles, fonts, space, useTheme } from '@/theme/tokens';

// The top bar of a screen pushed over the tabs: back on the left, the title centred.
export function BackHeader({ title }: { title?: string }) {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.bar}>
      <PressableScale
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={12}
        style={styles.side}>
        <CaretLeftIcon size={22} weight="bold" color={theme.text} />
      </PressableScale>
      <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
        {title ?? ''}
      </Text>
      <View style={styles.side} />
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    minHeight: 56,
  },
  side: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
}));
