import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { Screen } from '@/components/ui/screen';
import { GUIDELINES, GUIDELINES_DATE, GUIDELINES_INTRO, GUIDELINES_VERSION } from '@/lib/guidelines';
import { acceptPolicies } from '@/lib/privacy';
import { createThemedStyles, fonts, radius, space } from '@/theme/tokens';

// The community guidelines, readable from sign-up (before an account exists) and from Account.
// With ?accept=1 (after the guidelines changed) it ends with an I accept button.
export default function Guidelines() {
  const styles = useStyles();
  const accepting = useLocalSearchParams<{ accept?: string }>().accept === '1';
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setSaving(true);
    const r = await acceptPolicies();
    setSaving(false);
    if (r.error !== null) setError(r.error);
    else router.back();
  }

  return (
    <Screen style={styles.screen}>
      <BackHeader title="Community guidelines" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>{GUIDELINES_INTRO}</Text>
        {GUIDELINES.map((section, i) => (
          <View key={section.title} style={styles.section}>
            <View style={styles.titleRow}>
              <Text style={styles.number}>{i + 1}</Text>
              <Text style={styles.title} accessibilityRole="header">
                {section.title}
              </Text>
            </View>
            {section.points.map((p) => (
              <View key={p} style={styles.point}>
                <View style={styles.bullet} />
                <Text style={styles.text}>{p}</Text>
              </View>
            ))}
          </View>
        ))}
        <Text style={styles.version}>
          Version {GUIDELINES_VERSION.replace('v', '')}, {GUIDELINES_DATE}. When these change in a way that matters, the app asks
          you to read them again.
        </Text>
        {accepting ? (
          <View style={styles.accept}>
            <FormMessage message={error} />
            <Button label="I accept" loading={saving} onPress={accept} />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  content: { padding: space.xl, paddingTop: space.sm, gap: space.xl, width: '100%', maxWidth: 640, alignSelf: 'center' },
  accept: { gap: space.sm },
  intro: { fontFamily: fonts.bodySemiBold, fontSize: 16, lineHeight: 24, color: t.text },
  section: { gap: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  number: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: t.accentTint,
    color: t.onAccentTint,
    textAlign: 'center',
    lineHeight: 28,
    fontFamily: fonts.bodyBold,
    fontSize: 14,
  },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 18, color: t.text },
  point: { flexDirection: 'row', gap: space.sm, paddingLeft: space.xs },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.textMuted, marginTop: 9 },
  text: { flex: 1, fontFamily: fonts.body, fontSize: 15, lineHeight: 23, color: t.text },
  version: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: t.textMuted,
    borderTopWidth: 1,
    borderTopColor: t.border,
    paddingTop: space.md,
    borderRadius: radius.sm,
  },
}));
