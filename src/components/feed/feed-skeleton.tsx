import { View } from 'react-native';

import { createThemedStyles, radius, space } from '@/theme/tokens';

// Two post shapes while a filter loads, so the list does not jump when the posts arrive.
export function FeedSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.wrap} accessibilityLabel="Loading posts" accessible>
      {[0, 1].map((n) => (
        <View key={n} style={styles.card}>
          <View style={styles.row}>
            <View style={styles.avatar} />
            <View style={styles.lines}>
              <View style={[styles.block, { width: '45%', height: 14 }]} />
              <View style={[styles.block, { width: '65%', height: 12 }]} />
            </View>
          </View>
          <View style={[styles.block, { width: '92%', height: 14 }]} />
          <View style={[styles.block, { width: '70%', height: 14 }]} />
          {n === 0 ? <View style={[styles.block, { width: '100%', aspectRatio: 1.6, borderRadius: radius.md }]} /> : null}
        </View>
      ))}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  wrap: { gap: space.md },
  card: { borderWidth: 1, borderColor: t.border, borderRadius: radius.lg, padding: space.md, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.surface },
  lines: { flex: 1, gap: 6 },
  block: { backgroundColor: t.surface, borderRadius: 6 },
}));
