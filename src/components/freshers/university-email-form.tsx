import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';

import { Button } from '@/components/ui/button';
import { CodeInput } from '@/components/ui/code-input';
import { FormMessage } from '@/components/ui/form-message';
import { TextField } from '@/components/ui/text-field';
import { confirmEmailCode, loadMyFresher, startEmailChange, type MyFresher } from '@/lib/freshers';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Step = 'email' | 'codes' | 'done';

// A fresher adds the university email their university gave them. It becomes their sign-in email,
// and the account becomes a full student account: posting, the Shop and kuppi open, the letter is
// deleted. For safety Supabase sends a code to both the current and the new email.
export function UniversityEmailForm({ onDone }: { onDone?: () => void }) {
  const theme = useTheme();
  const styles = useStyles();
  const session = useSession();
  const kind = session.status === 'signed_in' ? session.claims.accountKind : 'fresher';
  const [me, setMe] = useState<MyFresher | null>(null);
  const [chosenStep, setStep] = useState<Step>('email');
  // The token after the change says student: done, whichever code went in last.
  const step: Step = kind === 'student' && chosenStep !== 'email' ? 'done' : chosenStep;
  const [email, setEmail] = useState('');
  const [newCode, setNewCode] = useState('');
  const [oldCode, setOldCode] = useState('');
  const [confirmed, setConfirmed] = useState<{ new: boolean; old: boolean }>({ new: false, old: false });
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMyFresher().then((r) => setMe(r.data));
  }, []);

  const domain = me?.domains[0];

  async function send() {
    setBusy(true);
    setError(null);
    const failed = await startEmailChange(email);
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    setStep('codes');
  }

  async function confirm(which: 'new' | 'old', code: string) {
    const address = which === 'new' ? email : (me?.email ?? '');
    setBusy(true);
    setError(null);
    const failed = await confirmEmailCode(address, code);
    if (failed) {
      setBusy(false);
      setError(failed);
      setShake((k) => k + 1);
      if (which === 'new') setNewCode('');
      else setOldCode('');
      return;
    }
    setConfirmed((c) => ({ ...c, [which]: true }));
    // When both are in, the email has changed: a fresh token carries the new account kind.
    await supabase.auth.refreshSession();
    setBusy(false);
  }

  if (step === 'done') {
    return (
      <View style={styles.done}>
        <CheckCircleIcon size={56} weight="fill" color={theme.accentText} />
        <Text style={styles.doneTitle}>You are verified</Text>
        <Text style={styles.body}>
          You now sign in with {email.trim().toLowerCase() || 'your university email'}. Posting, the Shop and kuppi are open to
          you, and your selection letter has been deleted.
        </Text>
        {onDone ? <Button label="Done" onPress={onDone} /> : null}
      </View>
    );
  }

  if (step === 'codes') {
    return (
      <View style={styles.stack}>
        <Text style={styles.body}>We sent a 6-digit code to each email. Enter both to finish.</Text>
        <View style={styles.codeBlock}>
          <Text style={styles.codeLabel}>{confirmed.new ? `Confirmed: ${email.trim()}` : `Code sent to ${email.trim()}`}</Text>
          {confirmed.new ? null : (
            <CodeInput
              value={newCode}
              onChange={(v) => {
                setNewCode(v);
                if (v.length === 6) confirm('new', v);
              }}
              shakeKey={shake}
              disabled={busy}
            />
          )}
        </View>
        {me?.email ? (
          <View style={styles.codeBlock}>
            <Text style={styles.codeLabel}>{confirmed.old ? `Confirmed: ${me.email}` : `Code sent to ${me.email}`}</Text>
            {confirmed.old ? null : (
              <CodeInput
                value={oldCode}
                onChange={(v) => {
                  setOldCode(v);
                  if (v.length === 6) confirm('old', v);
                }}
                shakeKey={shake}
                disabled={busy}
              />
            )}
          </View>
        ) : null}
        <FormMessage message={error} />
        <Button
          label="Use a different email"
          variant="quiet"
          onPress={() => {
            setStep('email');
            setConfirmed({ new: false, old: false });
            setError(null);
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <Text style={styles.body}>
        Use the email {me?.institution?.short_name ?? me?.institution?.name ?? 'your university'} gave you. It becomes the email
        you sign in with.
      </Text>
      <TextField
        label="University email"
        value={email}
        onChangeText={setEmail}
        placeholder={domain ? `you@${domain}` : 'you@stu.university.ac.lk'}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        returnKeyType="send"
        onSubmitEditing={send}
      />
      <FormMessage message={error} />
      <Button label="Send codes" onPress={send} loading={busy} disabled={email.trim().length < 5} />
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  stack: { gap: space.lg },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: t.text },
  codeBlock: { gap: space.sm, backgroundColor: t.surface, borderRadius: radius.lg, padding: space.md },
  codeLabel: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted },
  done: { alignItems: 'center', gap: space.md, paddingVertical: space.xl },
  doneTitle: { fontFamily: fonts.display, fontSize: 26, color: t.text },
}));
