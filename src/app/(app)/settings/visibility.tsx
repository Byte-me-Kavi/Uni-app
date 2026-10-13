import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { OptionList } from '@/components/settings/option-list';
import { BackHeader } from '@/components/ui/back-header';
import { Screen } from '@/components/ui/screen';
import { LEVELS, loadVisibility, setVisibility, type Field, type Level, type Visibility } from '@/lib/privacy';
import { useIsFresher } from '@/providers/session-provider';
import { createThemedStyles, fonts, space, useTheme } from '@/theme/tokens';

const FIELDS: { field: Field; title: string; lead: string }[] = [
  { field: 'photo', title: 'Your photo', lead: 'Who sees your photo on your card and in search.' },
  { field: 'bio', title: 'About you', lead: 'Who sees the "about" line on your card.' },
  { field: 'batch', title: 'Your batch', lead: 'Who sees your degree programme and year.' },
];

// Who sees each part of your card. Your name and university are always shown to anyone who can
// find you; everything else is your choice. Applies on tap.
export default function VisibilitySettings() {
  const theme = useTheme();
  const styles = useStyles();
  const fresher = useIsFresher();
  const [v, setV] = useState<Visibility | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    loadVisibility().then((r) => (r.error !== null ? setError(true) : setV(r.data)));
  }, []);

  async function choose(field: Field, level: Level) {
    if (!v || v[field] === level) return;
    const previous = v;
    setV({ ...v, [field]: level });
    setError(false);
    const r = await setVisibility(field, level);
    if (r.error !== null) {
      setV(previous);
      setError(true);
    }
  }

  return (
    <Screen style={styles.screen}>
      <BackHeader title="Who sees your details" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.lead}>Your name and university are shown to anyone who can find you. The rest is up to you.</Text>
        {fresher ? (
          <Text style={styles.note}>As a fresher, your photo is shown only to your batch, whatever you choose here.</Text>
        ) : null}
        {!v ? (
          error ? null : (
            <ActivityIndicator color={theme.accentText} />
          )
        ) : (
          FIELDS.map((f) => (
            <View key={f.field} style={styles.section}>
              <Text style={styles.heading} accessibilityRole="header">
                {f.title}
              </Text>
              <Text style={styles.note}>{f.lead}</Text>
              <OptionList options={LEVELS} value={v[f.field]} onChange={(level) => choose(f.field, level)} />
            </View>
          ))
        )}
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            Could not save this. Check your connection and try again.
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  content: { padding: space.xl, paddingTop: space.sm, gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  lead: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: t.textMuted },
  section: { gap: space.sm },
  heading: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  note: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
  error: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 19, color: t.dangerText },
}));
