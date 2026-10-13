import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, Text, View } from 'react-native';

import { ActionSheet } from '@/components/ui/action-sheet';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { appVersion, refreshAppConfig, type Feature } from '@/lib/app-config';
import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Settings = Record<string, { value: unknown; updated_at: string }>;

// What each switch stops, in the words a student would see. Order: most likely to be needed first.
const SWITCHES: { feature: Feature; label: string; detail: string }[] = [
  { feature: 'uploads', label: 'Uploads', detail: 'Photos, files and voice notes in chats, posts, the Shop and shared files' },
  { feature: 'posting', label: 'Posts and comments', detail: 'New feed posts and comments; reading and likes still work' },
  { feature: 'new_dms', label: 'New direct chats', detail: 'Starting a chat with someone new; existing chats keep working' },
  { feature: 'shop', label: 'Shop', detail: 'New listings, orders and interest' },
  { feature: 'kuppi', label: 'Kuppi', detail: 'New sessions, requests and joining' },
  { feature: 'signup', label: 'Sign-up', detail: 'New accounts with a university email' },
  { feature: 'fresher_signup', label: 'Fresher sign-up', detail: 'New fresher accounts with a selection letter' },
];

// National admins: switch a feature off during an incident without an app release, set the oldest
// app version that may still be used, and put a notice on everyone's Home. The database enforces
// every switch and audits every change.
export default function AppSwitches() {
  const theme = useTheme();
  const styles = useStyles();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<(typeof SWITCHES)[number] | null>(null);
  const [minVersion, setMinVersion] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState<'version' | 'notice' | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('admin_settings');
    if (e) {
      setError(e.message);
      return;
    }
    apply(data as Settings);
  }, []);

  function apply(s: Settings) {
    setSettings(s);
    setMinVersion(typeof s['app.min_version']?.value === 'string' ? (s['app.min_version'].value as string) : '');
    setNotice(typeof s['app.notice']?.value === 'string' ? (s['app.notice'].value as string) : '');
  }

  useEffect(() => {
    let live = true;
    supabase.rpc('admin_settings').then(({ data, error: e }) => {
      if (!live) return;
      if (e) setError(e.message);
      else apply(data as Settings);
    });
    return () => {
      live = false;
    };
  }, []);

  async function save(key: string, value: Json) {
    setError(null);
    setSaved(null);
    const { error: e } = await supabase.rpc('set_setting', { p_key: key, p_value: value });
    if (e) {
      setError(e.message);
      return false;
    }
    await load();
    refreshAppConfig(true);
    return true;
  }

  function isOn(feature: Feature) {
    return settings?.[`feature.${feature}`]?.value !== false;
  }

  if (!settings) {
    return (
      <Screen style={styles.screen}>
        <BackHeader title="App switches" />
        <View style={styles.center}>
          {error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} />}
        </View>
      </Screen>
    );
  }

  return (
    <Screen style={styles.screen} edges={['top']}>
      <BackHeader title="App switches" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>
          Turn a feature off for every student at once, for example while something is going wrong. It stops on the server
          straight away; apps notice within a few minutes.
        </Text>
        <FormMessage message={error} />

        <View style={styles.card}>
          {SWITCHES.map((s, i) => {
            const on = isOn(s.feature);
            return (
              <View key={s.feature} style={[styles.row, i > 0 && styles.divider]}>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{s.label}</Text>
                  <Text style={[styles.note, !on && styles.off]}>{on ? s.detail : 'Paused for everyone'}</Text>
                </View>
                <Switch
                  value={on}
                  onValueChange={(next) => {
                    if (next) save(`feature.${s.feature}`, true);
                    else setConfirm(s);
                  }}
                  trackColor={{ true: theme.accentText, false: theme.border }}
                  thumbColor={brand.white}
                  accessibilityLabel={s.label}
                />
              </View>
            );
          })}
        </View>

        <View style={styles.section}>
          <Text style={styles.heading} accessibilityRole="header">
            Notice on Home
          </Text>
          <TextField
            label="Message to every student"
            value={notice}
            onChangeText={setNotice}
            hint="Up to 200 characters. Leave empty for none."
            maxLength={200}
            multiline
          />
          <View style={styles.buttons}>
            <Button
              label="Save notice"
              loading={saving === 'notice'}
              onPress={async () => {
                setSaving('notice');
                if (await save('app.notice', notice.trim() || null))
                  setSaved(notice.trim() ? 'Notice is live.' : 'Notice removed.');
                setSaving(null);
              }}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading} accessibilityRole="header">
            Oldest app version allowed
          </Text>
          <TextField
            label="Minimum version"
            value={minVersion}
            onChangeText={setMinVersion}
            hint={`Older apps must update before they can be used. This phone runs ${appVersion}.`}
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
          />
          <Button
            label="Save version"
            variant="quiet"
            loading={saving === 'version'}
            onPress={async () => {
              setSaving('version');
              if (await save('app.min_version', minVersion.trim())) setSaved(`Apps older than ${minVersion.trim()} must update.`);
              setSaving(null);
            }}
          />
        </View>
        <FormMessage message={saved} tone="info" />
      </ScrollView>

      <ActionSheet
        visible={!!confirm}
        title={confirm ? `Pause ${confirm.label.toLowerCase()}?` : undefined}
        message={confirm ? `${confirm.detail}. Students see "paused for now" until you switch it back on.` : undefined}
        actions={[
          {
            label: 'Pause for everyone',
            destructive: true,
            onPress: () => {
              if (confirm) save(`feature.${confirm.feature}`, false);
            },
          },
        ]}
        onClose={() => setConfirm(null)}
      />
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  content: { padding: space.xl, paddingTop: space.sm, gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  lead: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: t.text },
  section: { gap: space.md },
  heading: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted, paddingHorizontal: space.xs },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, paddingHorizontal: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  divider: { borderTopWidth: 1, borderTopColor: t.border },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: t.text },
  note: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
  off: { fontFamily: fonts.bodyBold, color: t.dangerText },
  buttons: { gap: space.sm },
}));
