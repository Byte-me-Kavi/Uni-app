import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { OptionList } from '@/components/settings/option-list';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { enablePush, openPhoneSettings, pushStatus, type PushStatus } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { createThemedStyles, fonts, space } from '@/theme/tokens';

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

// Whether this phone gets notifications, and whether they show the message text.
export default function NotificationSettings() {
  const styles = useStyles();
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
      </ScrollView>
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
}));
