import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { OptionList } from '@/components/settings/option-list';
import { BackHeader } from '@/components/ui/back-header';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { enablePush, openPhoneSettings, pushStatus, type PushStatus } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

const PREVIEWS = [
  { value: 'on', label: 'Show message text', detail: '“Kavindu: are you coming to the lab?”' },
  { value: 'off', label: 'Hide message text', detail: '“New message” only. Better if others see your lock screen.' },
] as const;
type Previews = (typeof PREVIEWS)[number]['value'];

const STATUS_COPY: Record<PushStatus, string> = {
  granted: 'Notifications are on for this phone.',
  undetermined: 'Notifications are off. Turn them on to hear about new messages with the app closed.',
  denied: 'Notifications are blocked in your phone’s settings. Allow them there for Uni Era.',
  unsupported: 'This version of the app cannot get notifications. Install Uni Era from the store or a development build.',
};

type Quiet = { quiet_enabled: boolean; quiet_start: number; quiet_end: number };

// Minutes after midnight, as "11:00 pm".
const clock = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
const TIMES = Array.from({ length: 48 }, (_, i) => i * 30);

// Whether this phone gets notifications, whether they show the message text, and quiet hours.
export default function NotificationSettings() {
  const theme = useTheme();
  const styles = useStyles();
  const [quiet, setQuiet] = useState<Quiet | null>(null);
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const [quietError, setQuietError] = useState(false);
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [previews, setPreviews] = useState<Previews | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  // Also on return from the phone's settings, where they may have just allowed notifications.
  useFocusEffect(
    useCallback(() => {
      pushStatus().then(setStatus);
      supabase.rpc('message_previews').then(({ data, error: loadError }) => {
        if (!loadError) setPreviews(data === false ? 'off' : 'on');
      });
      supabase.rpc('notification_settings').then(({ data }) => data && setQuiet(data as Quiet));
    }, []),
  );

  async function turnOn() {
    setBusy(true);
    await enablePush().catch(() => false);
    setStatus(await pushStatus());
    setBusy(false);
  }

  async function choose(value: Previews) {
    if (value === previews) return;
    const previous = previews;
    setPreviews(value);
    setError(false);
    const { error: saveError } = await supabase.rpc('set_message_previews', { p_on: value === 'on' });
    if (saveError) {
      setPreviews(previous);
      setError(true);
    }
  }

  // Saved at once; put back if the server says no.
  async function saveQuiet(next: Quiet) {
    const previous = quiet;
    setQuiet(next);
    setQuietError(false);
    const { data, error: saveError } = await supabase.rpc('set_quiet_hours', {
      p_enabled: next.quiet_enabled,
      p_start: next.quiet_start,
      p_end: next.quiet_end,
    });
    if (saveError) {
      setQuiet(previous);
      setQuietError(true);
    } else if (data) setQuiet(data as Quiet);
  }

  return (
    <Screen style={styles.screen}>
      <BackHeader title="Notifications" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.lead}>{status ? STATUS_COPY[status] : ' '}</Text>
          {status === 'undetermined' ? <Button label="Turn on notifications" onPress={turnOn} loading={busy} /> : null}
          {status === 'denied' ? <Button label="Open phone settings" variant="quiet" onPress={openPhoneSettings} /> : null}
          <Text style={styles.note}>
            Direct messages notify you every time. Groups notify you once, then again after you read them or 15 minutes
            later. Muted chats stay silent.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading} accessibilityRole="header">
            On the lock screen
          </Text>
          <OptionList options={[...PREVIEWS]} value={previews} onChange={choose} disabled={!previews} />
          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              Could not save this. Check your connection and try again.
            </Text>
          ) : (
            <Text style={styles.note}>Applies to all your phones.</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.heading} accessibilityRole="header">
            Quiet hours
          </Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Silence notifications at night</Text>
                <Text style={styles.note}>Messages still arrive; your phone stays quiet until the morning.</Text>
              </View>
              <Switch
                value={!!quiet?.quiet_enabled}
                disabled={!quiet}
                onValueChange={(on) => {
                  if (quiet) saveQuiet({ ...quiet, quiet_enabled: on });
                }}
                trackColor={{ true: theme.accentText, false: theme.border }}
                thumbColor={brand.white}
                accessibilityLabel="Quiet hours"
              />
            </View>
            {quiet?.quiet_enabled ? (
              <>
                <Pressable onPress={() => setPicking('start')} accessibilityRole="button" style={[styles.row, styles.divider]}>
                  <Text style={styles.rowLabel}>From</Text>
                  <Text style={styles.rowValue}>{clock(quiet.quiet_start)}</Text>
                </Pressable>
                <Pressable onPress={() => setPicking('end')} accessibilityRole="button" style={[styles.row, styles.divider]}>
                  <Text style={styles.rowLabel}>Until</Text>
                  <Text style={styles.rowValue}>{clock(quiet.quiet_end)}</Text>
                </Pressable>
              </>
            ) : null}
          </View>
          {quietError ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              Could not save this. Check your connection and try again.
            </Text>
          ) : (
            <Text style={styles.note}>Sri Lanka time. Applies to all your phones, mentions included.</Text>
          )}
        </View>
      </ScrollView>

      <BottomSheet visible={!!picking} title={picking === 'start' ? 'Quiet from' : 'Quiet until'} onClose={() => setPicking(null)} height={0.6}>
        <ScrollView contentContainerStyle={styles.times}>
          {TIMES.map((minutes) => {
            const chosen = quiet && (picking === 'start' ? quiet.quiet_start : quiet.quiet_end) === minutes;
            return (
              <Pressable
                key={minutes}
                onPress={() => {
                  if (quiet) saveQuiet({ ...quiet, ...(picking === 'start' ? { quiet_start: minutes } : { quiet_end: minutes }) });
                  setPicking(null);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: !!chosen }}
                style={({ pressed }) => [styles.time, chosen && styles.timeChosen, pressed && styles.pressed]}>
                <Text style={[styles.timeText, chosen && styles.timeTextChosen]}>{clock(minutes)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </BottomSheet>
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  content: { padding: space.xl, paddingTop: space.sm, gap: space.xxl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  section: { gap: space.md },
  heading: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted, paddingHorizontal: space.xs },
  lead: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: t.text },
  note: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
  error: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 19, color: t.dangerText },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, paddingHorizontal: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  divider: { borderTopWidth: 1, borderTopColor: t.border },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 16, color: t.text },
  rowValue: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  times: { paddingHorizontal: space.lg, paddingBottom: space.lg },
  time: { paddingVertical: space.md, paddingHorizontal: space.md, borderRadius: radius.md },
  timeChosen: { backgroundColor: t.surface },
  pressed: { opacity: 0.6 },
  timeText: { fontFamily: fonts.body, fontSize: 16, color: t.text },
  timeTextChosen: { fontFamily: fonts.bodyBold },
}));
