import { View } from 'react-native';

import { createThemedStyles, radius, space } from '@/theme/tokens';

// Same shapes as the loaded screen, so nothing jumps when the data arrives.
export function HomeSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.wrap} accessibilityLabel="Loading" accessible>
      <View style={[styles.block, { width: '55%', height: 34 }]} />
      <View style={[styles.block, { width: '75%', height: 18, marginTop: -space.sm }]} />
      <View style={[styles.block, { height: 172, borderRadius: radius.lg + 6 }]} />
      <View style={[styles.block, { width: '35%', height: 24 }]} />
      <View style={[styles.block, { height: 212, borderRadius: radius.lg }]} />
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  wrap: { gap: space.xl },
  block: { backgroundColor: t.surface, borderRadius: radius.sm, width: '100%' },
}));
