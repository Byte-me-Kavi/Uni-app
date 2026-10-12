import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { ChatsCircleIcon } from 'phosphor-react-native/src/icons/ChatsCircle';
import { ShieldCheckIcon } from 'phosphor-react-native/src/icons/ShieldCheck';

import { ReportSheet, type ReportTarget } from '@/components/chat/report-sheet';
import { ActionSheet } from '@/components/ui/action-sheet';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { openChat } from '@/lib/chat/open-chat';
import { cancelKuppi, cancelRsvp, joinKuppi, kuppiWhen, loadKuppi, PLATFORM_LABEL, rsvp, type Kuppi } from '@/lib/kuppi';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// "Opens in 2 h 5 min", "Opens in 4 min".
function countdown(ms: number) {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.round(hours / 24)} days`;
}

// One kuppi: when and where, RSVP, and the Join button, which unlocks 15 minutes before the start
// and opens Zoom, Meet or Teams.
export default function KuppiScreen() {
  const theme = useTheme();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [kuppi, setKuppi] = useState<Kuppi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);

  useEffect(() => {
    let live = true;
    loadKuppi(id).then((r) => {
      if (!live) return;
      setKuppi(r.kuppi);
      setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [id]);

  // The countdown ticks every 20 seconds while the screen is open.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(timer);
  }, []);

  const act = useCallback(async (call: () => Promise<{ kuppi: Kuppi | null; error: string | null }>) => {
    setBusy(true);
    setError(null);
    const r = await call();
    setBusy(false);
    if (r.kuppi) setKuppi(r.kuppi);
    setError(r.error);
  }, []);

  async function join() {
    setBusy(true);
    setError(null);
    setError(await joinKuppi(id));
    setBusy(false);
  }

  if (!kuppi) {
    return (
      <Screen style={styles.screen}>
        <BackHeader title="Kuppi" />
        <View style={styles.center}>{error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} />}</View>
      </Screen>
    );
  }

  const opensIn = Date.parse(kuppi.link_opens_at) - now;
  const over = Date.parse(kuppi.ends_at) + 30 * 60_000 < now;
  const online = kuppi.mode === 'online';
  const canJoin = online && !kuppi.cancelled && !over && (kuppi.hosting || (kuppi.rsvped && opensIn <= 0));

  return (
    <Screen style={styles.screen}>
      <BackHeader title="Kuppi" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.stack}>
          <View style={styles.head}>
            {kuppi.other ? (
              <Text style={styles.code}>
                {kuppi.module.code} · {kuppi.module.name} · {kuppi.institution ?? 'another university'}
              </Text>
            ) : (
              <PressableScale
                onPress={() => router.push({ pathname: '/module/[id]', params: { id: String(kuppi.module.id) } })}
                accessibilityRole="link"
                hitSlop={6}>
                <Text style={styles.code}>
                  {kuppi.module.code} · {kuppi.module.name}
                </Text>
              </PressableScale>
            )}
            <Text style={styles.title} accessibilityRole="header">
              {kuppi.title}
            </Text>
            <Text style={styles.when}>{kuppiWhen(kuppi)}</Text>
            <Text style={styles.muted}>
              {online ? (kuppi.platform ? PLATFORM_LABEL[kuppi.platform] : 'Online') : kuppi.venue} · hosted by{' '}
              {kuppi.hosting ? 'you' : (kuppi.host?.name ?? 'a student')}
            </Text>
            <Text style={styles.muted}>
              {kuppi.going} of {kuppi.capacity} going{kuppi.full && !kuppi.rsvped ? ' · full' : ''}
              {kuppi.scope === 'national' ? ' · open to all universities' : ''}
            </Text>
          </View>

          {kuppi.cancelled ? (
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>Cancelled</Text>
              {kuppi.cancel_reason ? <Text style={styles.muted}>{kuppi.cancel_reason}</Text> : null}
            </View>
          ) : null}

          {kuppi.description ? <Text style={styles.body}>{kuppi.description}</Text> : null}

          <FormMessage message={error} />

          {!kuppi.cancelled && !over ? (
            <View style={styles.actions}>
              {online && (kuppi.hosting || kuppi.rsvped) ? (
                canJoin ? (
                  <Button label={`Join on ${kuppi.platform ? PLATFORM_LABEL[kuppi.platform] : 'the meeting'}`} loading={busy} onPress={join} />
                ) : (
                  <View style={styles.locked}>
                    <Text style={styles.lockedTitle}>The link opens in {countdown(opensIn)}</Text>
                    <Text style={styles.lockedBody}>15 minutes before the start, so it does not get passed around early.</Text>
                  </View>
                )
              ) : null}
              {!kuppi.hosting ? (
                kuppi.rsvped ? (
                  <Button label="Cancel my RSVP" variant="quiet" loading={busy && !canJoin} onPress={() => act(() => cancelRsvp(id))} />
                ) : (
                  <Button
                    label={kuppi.full ? 'Full' : 'RSVP'}
                    disabled={kuppi.full}
                    loading={busy}
                    onPress={() => act(() => rsvp(id))}
                  />
                )
              ) : null}
            </View>
          ) : null}

          {kuppi.chat_id ? (
            <PressableScale onPress={() => openChat(kuppi.chat_id!)} accessibilityRole="button" scale={0.985} style={styles.chat}>
              <ChatsCircleIcon size={22} weight="bold" color={theme.text} />
              <View style={styles.chatCopy}>
                <Text style={styles.chatTitle}>Kuppi chat</Text>
                <Text style={styles.muted}>The host and everyone going. Slides shared here go to {kuppi.other ? 'your module on this subject' : kuppi.module.name}.</Text>
              </View>
            </PressableScale>
          ) : null}

          {kuppi.hosting && online && !kuppi.cancelled ? (
            <View style={styles.tips}>
              <ShieldCheckIcon size={22} weight="bold" color={theme.text} />
              <Text style={styles.tipsText}>
                Turn on a waiting room or passcode, and host from your university account: free Zoom meetings stop
                after 40 minutes.
              </Text>
            </View>
          ) : null}

          {kuppi.hosting && !kuppi.cancelled && !over ? (
            <Button label="Cancel this kuppi" variant="quiet" onPress={() => setConfirmCancel(true)} />
          ) : null}
          {!kuppi.hosting ? (
            <PressableScale
              onPress={() => setReporting({ kind: 'kuppi', id, who: kuppi.host?.name ?? null, userId: kuppi.host?.id ?? null })}
              accessibilityRole="button"
              hitSlop={8}>
              <Text style={styles.report}>Report this kuppi</Text>
            </PressableScale>
          ) : null}
        </View>
      </ScrollView>

      <ActionSheet
        visible={confirmCancel}
        title="Cancel this kuppi?"
        message="Everyone going sees it was cancelled. You can explain in the kuppi chat."
        actions={[{ label: 'Cancel kuppi', destructive: true, onPress: () => act(() => cancelKuppi(id)) }]}
        onClose={() => setConfirmCancel(false)}
      />
      <ReportSheet target={reporting} onClose={() => setReporting(null)} />
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  content: { padding: space.xl, paddingBottom: space.xxxl },
  stack: { gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  head: { gap: space.xs },
  code: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.accentText },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: t.text, letterSpacing: -0.3 },
  when: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text, marginTop: space.xs },
  muted: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.textMuted },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: t.text },
  notice: { backgroundColor: t.errorBg, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  noticeTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.errorText },
  actions: { gap: space.md },
  locked: { backgroundColor: t.accentTint, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  lockedTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.onAccentTint },
  // Ink on the tint in both themes.
  lockedBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.onAccentTint },
  chat: { flexDirection: 'row', gap: space.md, alignItems: 'center', backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg },
  chatCopy: { flex: 1, gap: 2 },
  chatTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  tips: { flexDirection: 'row', gap: space.md, backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg },
  tipsText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.text },
  report: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.dangerText },
}));
