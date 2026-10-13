import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, Text, View } from 'react-native';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';

import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { dayMonth } from '@/lib/dates';
import { loadConsents, PURPOSE_COPY, setConsent, type Consents } from '@/lib/privacy';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// The consent centre: what you agreed to (and which version, when), and every optional use of your
// data as its own switch, off until you turn it on, as easy to turn off as on. Each change is kept
// as a record.
export default function ConsentCentre() {
  const theme = useTheme();
  const styles = useStyles();
  const [c, setC] = useState<Consents | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadConsents().then((r) => (r.error !== null ? setError(r.error) : setC(r.data)));
  }, []);

  async function toggle(code: string, on: boolean) {
    if (!c) return;
    const previous = c;
    setC({ ...c, purposes: c.purposes.map((p) => (p.code === code ? { ...p, granted: on } : p)) });
    setError(null);
    const r = await setConsent(code, on);
    if (r.error !== null) {
      setC(previous);
      setError('Could not save this. Check your connection and try again.');
    } else setC(r.data);
  }

  const required = c?.purposes.filter((p) => p.required) ?? [];
  const optional = c?.purposes.filter((p) => !p.required) ?? [];

  return (
    <Screen style={styles.screen}>
      <BackHeader title="Privacy and consent" />
      <ScrollView contentContainerStyle={styles.content}>
        {!c ? (
          error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <ActivityIndicator color={theme.accentText} />
          )
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.heading} accessibilityRole="header">
                Your choices
              </Text>
              <Text style={styles.note}>All off until you turn them on. Turning one off takes effect straight away.</Text>
              <View style={styles.card}>
                {optional.map((p, i) => (
                  <View key={p.code} style={[styles.row, i > 0 && styles.divider]}>
                    <View style={styles.rowText}>
                      <Text style={styles.label}>{PURPOSE_COPY[p.code]?.label ?? p.code}</Text>
                      <Text style={styles.note}>{PURPOSE_COPY[p.code]?.detail}</Text>
                    </View>
                    <Switch
                      value={p.granted}
                      onValueChange={(on) => toggle(p.code, on)}
                      trackColor={{ true: theme.accentText, false: theme.border }}
                      thumbColor={brand.white}
                      accessibilityLabel={PURPOSE_COPY[p.code]?.label ?? p.code}
                    />
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.heading} accessibilityRole="header">
                Needed to use Uni Era
              </Text>
              <Text style={styles.note}>To withdraw these, delete your account.</Text>
              <View style={styles.card}>
                {required.map((p, i) => (
                  <View key={p.code} style={[styles.row, i > 0 && styles.divider]}>
                    <CheckCircleIcon size={22} weight="fill" color={theme.accentText} />
                    <View style={styles.rowText}>
                      <Text style={styles.label}>{PURPOSE_COPY[p.code]?.label ?? p.code}</Text>
                      <Text style={styles.note}>
                        {p.recorded_at
                          ? `Agreed to version ${(p.agreed_version ?? '').replace('v', '')} on ${dayMonth(p.recorded_at)}`
                          : 'Not recorded'}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
              <Button label="Read the community guidelines" variant="quiet" onPress={() => router.push('/guidelines')} />
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  content: { padding: space.xl, paddingTop: space.sm, gap: space.xxl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  section: { gap: space.sm },
  heading: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, paddingHorizontal: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  divider: { borderTopWidth: 1, borderTopColor: t.border },
  rowText: { flex: 1, gap: 2 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: t.text },
  note: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
  error: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.dangerText },
}));
