import type { ComponentType } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { IconProps } from 'phosphor-react-native';

import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

export type TabFeature = { title: string; body: string };

type Props = {
  title: string;
  intro: string;
  Icon: ComponentType<IconProps>;
  features: TabFeature[];
};

// A tab whose feature is not built yet. It says plainly what the tab will hold and that it opens
// soon, instead of showing invented chats, notes or events.
export function TabIntro({ title, intro, Icon, features }: Props) {
  const theme = useTheme();
  const styles = useStyles();

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.stack}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          <Text style={styles.intro}>{intro}</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.cardTop}>
            <View style={styles.icon}>
              <Icon size={24} weight="bold" color={brand.ink} />
            </View>
            <Text style={styles.soon}>Opens soon</Text>
          </View>
          <View style={styles.features}>
            {features.map((f) => (
              <View key={f.title} style={styles.feature}>
                <View style={[styles.dot, { backgroundColor: theme.text }]} />
                <View style={styles.featureCopy}>
                  <Text style={styles.featureTitle}>{f.title}</Text>
                  <Text style={styles.featureBody}>{f.body}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const useStyles = createThemedStyles((t) => ({
  scroll: { flex: 1 },
  content: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.xxxl },
  stack: { gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { gap: space.sm },
  title: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, color: t.text, letterSpacing: -0.3 },
  intro: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: t.textMuted },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.xl, gap: space.xl },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Accent tile with an Ink icon: text and icons on the accent are always Ink.
  icon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: brand.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  soon: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: brand.ink,
    backgroundColor: brand.accentTint,
    paddingHorizontal: space.sm + 2,
    paddingVertical: 3,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  features: { gap: space.lg },
  feature: { flexDirection: 'row', gap: space.md },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 9 },
  featureCopy: { flex: 1, gap: 2 },
  featureTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  featureBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted },
}));
