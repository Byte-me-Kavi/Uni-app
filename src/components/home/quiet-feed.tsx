import { Text, View } from 'react-native';
import { SparkleIcon } from 'phosphor-react-native/src/icons/Sparkle';

import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// Empty state for the feed. Says what will appear and what unlocks it; no invented content.
export function QuietFeed() {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text style={styles.heading} accessibilityRole="header">
        Your feed
      </Text>
      <View style={styles.card}>
        <View style={styles.icon}>
          <SparkleIcon size={22} weight="bold" color={theme.text} />
        </View>
        <Text style={styles.title}>Quiet for now</Text>
        <Text style={styles.body}>
          New notes, kuppi and events from your university and from students across the country will
          show up here.
        </Text>
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  section: { gap: space.md },
  heading: { fontFamily: fonts.display, fontSize: 21, color: t.text },
  card: {
    alignItems: 'flex-start',
    gap: space.sm,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: t.border,
    padding: space.xl,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.surface,
    marginBottom: space.xs,
  },
  title: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted, maxWidth: 420 },
}));
