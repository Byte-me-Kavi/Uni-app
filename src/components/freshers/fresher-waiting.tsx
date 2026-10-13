import { useCallback, useEffect, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { CameraIcon } from 'phosphor-react-native/src/icons/Camera';
import { FilePdfIcon } from 'phosphor-react-native/src/icons/FilePdf';
import { ImageIcon } from 'phosphor-react-native/src/icons/Image';
import { LockSimpleIcon } from 'phosphor-react-native/src/icons/LockSimple';

import { AuthChrome } from '@/components/auth/auth-chrome';
import { AuthScreen } from '@/components/auth/auth-screen';
import { Reveal } from '@/components/motion/reveal';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { loadMyFresher, pickLetter, uploadLetter, type MyFresher } from '@/lib/freshers';
import { enablePush, pushStatus, pushSupported, registerPush, type PushStatus } from '@/lib/push';
import { signOut } from '@/lib/sign-out';
import { supabase } from '@/lib/supabase';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// A fresher before approval. The one thing they do: upload the selection letter. Then they wait
// (with a notification when they are in), or fix what the team asked for.
export function FresherWaiting() {
  const theme = useTheme();
  const styles = useStyles();
  const [me, setMe] = useState<MyFresher | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(
    () =>
      loadMyFresher().then((r) => {
        if (r.data) setMe(r.data);
      }),
    [],
  );

  useEffect(() => {
    loadMyFresher().then((r) => {
      if (r.data) setMe(r.data);
    });
    // Back in the app: maybe approved meanwhile. A new token updates the screen by itself.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        supabase.auth.refreshSession();
        load();
      }
    });
    return () => sub.remove();
  }, [load]);

  useEffect(() => {
    if (me?.status !== 'waiting' || !pushSupported) return;
    pushStatus().then((s) => {
      setPush(s);
      if (s === 'granted') registerPush().catch(() => {});
    });
  }, [me?.status]);

  async function choose(source: 'camera' | 'photos' | 'pdf') {
    setError(null);
    const file = await pickLetter(source);
    if (!file) return;
    if ('error' in file) {
      setError(file.error);
      return;
    }
    setProgress(0);
    const failed = await uploadLetter(file, setProgress);
    setProgress(null);
    if (failed) {
      setError(failed);
      return;
    }
    setReplacing(false);
    await load();
  }

  async function checkAgain() {
    setChecking(true);
    await supabase.auth.refreshSession();
    await load();
    setChecking(false);
  }

  const uploading = progress !== null;
  const asking = !me || me.status === 'needs_letter' || replacing;

  if (me?.status === 'rejected') {
    return (
      <AuthChrome>
        <AuthScreen
          title="We could not approve this account"
          subtitle="The Uni Era team read your letter and could not add you to a batch."
          footer={<Button label="Sign out" variant="quiet" onPress={() => signOut()} />}>
          {me.reason ? (
            <Reveal order={2} style={styles.reason}>
              <Text style={styles.reasonLabel}>Reason</Text>
              <Text style={styles.reasonText}>{me.reason}</Text>
            </Reveal>
          ) : null}
        </AuthScreen>
      </AuthChrome>
    );
  }

  if (!asking) {
    return (
      <AuthChrome waiting>
        <AuthScreen
          title="We're checking your letter"
          subtitle="The Uni Era team reads every letter and adds you to your batch. This usually takes less than a day."
          footer={<Button label="Sign out" variant="quiet" onPress={() => signOut()} />}>
          <Reveal order={2}>
            {push === 'undetermined' ? (
              <Button label="Notify me when I'm in" onPress={async () => setPush((await enablePush()) ? 'granted' : 'denied')} />
            ) : push === 'granted' ? (
              <Text style={styles.help}>We will send you a notification when you are in.</Text>
            ) : null}
          </Reveal>
          <Reveal order={3}>
            <Button
              label="Check again"
              variant={push === 'undetermined' ? 'quiet' : 'primary'}
              onPress={checkAgain}
              loading={checking}
            />
          </Reveal>
          <Reveal order={4}>
            <Button label="Upload a clearer letter" variant="quiet" onPress={() => setReplacing(true)} />
          </Reveal>
        </AuthScreen>
      </AuthChrome>
    );
  }

  const options: { source: 'camera' | 'photos' | 'pdf'; label: string; detail: string; Icon: typeof CameraIcon }[] = [
    { source: 'camera', label: 'Take a photo', detail: 'Lay the letter flat in good light', Icon: CameraIcon },
    { source: 'photos', label: 'Choose a photo', detail: 'A photo or screenshot you already have', Icon: ImageIcon },
    { source: 'pdf', label: 'Choose a PDF', detail: 'If UGC sent it as a file', Icon: FilePdfIcon },
  ];

  return (
    <AuthChrome>
      <AuthScreen
        title={me?.reason ? 'Upload your letter again' : 'Upload your selection letter'}
        subtitle="The letter UGC sent you, with your name and university showing. That is all we need to add you to your batch."
        footer={
          replacing ? (
            <Button label="Keep the letter I sent" variant="quiet" onPress={() => setReplacing(false)} />
          ) : (
            <Button label="Sign out" variant="quiet" onPress={() => signOut()} />
          )
        }>
        {me?.reason && !replacing ? (
          <Reveal order={2} style={styles.reason}>
            <Text style={styles.reasonLabel}>What to fix</Text>
            <Text style={styles.reasonText}>{me.reason}</Text>
          </Reveal>
        ) : null}
        <Reveal order={3} style={styles.options}>
          {options.map(({ source, label, detail, Icon }) => (
            <PressableScale
              key={source}
              onPress={() => choose(source)}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityHint={detail}
              style={[styles.option, uploading && styles.dim]}>
              <View style={styles.optionIcon}>
                <Icon size={22} weight="bold" color={theme.onAccentTint} />
              </View>
              <View style={styles.optionText}>
                <Text style={styles.optionLabel}>{label}</Text>
                <Text style={styles.optionDetail}>{detail}</Text>
              </View>
            </PressableScale>
          ))}
        </Reveal>
        {uploading ? (
          <View style={styles.progress} accessibilityLabel={`Uploading, ${Math.round((progress ?? 0) * 100)} percent`}>
            <View style={[styles.progressBar, { width: `${Math.max(4, Math.round((progress ?? 0) * 100))}%` }]} />
          </View>
        ) : null}
        <FormMessage message={error} />
        <Reveal order={4} style={styles.privacy}>
          <LockSimpleIcon size={16} weight="bold" color={theme.textMuted} />
          <Text style={styles.privacyText}>
            Only the Uni Era team sees your letter. It is deleted as soon as you add your university email.
          </Text>
        </Reveal>
      </AuthScreen>
    </AuthChrome>
  );
}

const useStyles = createThemedStyles((t) => ({
  reason: { backgroundColor: t.surface, borderRadius: radius.md, padding: space.lg, gap: space.xs },
  reasonLabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.textMuted },
  reasonText: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 21, color: t.text },
  help: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted },
  options: { gap: space.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    padding: space.md,
  },
  dim: { opacity: 0.5 },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: t.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: { flex: 1, gap: 2 },
  optionLabel: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  optionDetail: { fontFamily: fonts.body, fontSize: 14, color: t.textMuted },
  progress: { height: 6, borderRadius: 3, backgroundColor: t.surface, overflow: 'hidden' },
  progressBar: { height: 6, borderRadius: 3, backgroundColor: t.accent },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  privacyText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.textMuted },
}));
