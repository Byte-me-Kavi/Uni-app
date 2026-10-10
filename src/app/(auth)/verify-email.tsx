import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { AuthScreen } from '@/components/auth/auth-screen';
import { Reveal } from '@/components/motion/reveal';
import { Button } from '@/components/ui/button';
import { CodeInput } from '@/components/ui/code-input';
import { FormMessage } from '@/components/ui/form-message';
import { authErrorMessage } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';
import { createThemedStyles, fonts } from '@/theme/tokens';

const RESEND_SECONDS = 60;

export default function VerifyEmail() {
  const styles = useStyles();
  const params = useLocalSearchParams<{ email?: string; resend?: string }>();
  const email = params.email ?? '';
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const [cooldown, setCooldown] = useState(params.resend ? 0 : RESEND_SECONDS);

  useEffect(() => {
    if (!email) router.replace('/sign-in');
  }, [email]);

  // Arriving from sign-in with an unconfirmed email: send a fresh code once.
  useEffect(() => {
    if (params.resend && email) resend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function verify(token: string) {
    if (!/^\d{6}$/.test(token)) {
      setError('Enter the 6-digit code from the email.');
      setShakeKey((k) => k + 1);
      return;
    }
    setVerifying(true);
    setError(null);
    setInfo(null);
    const { error: verifyError } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    setVerifying(false);
    if (verifyError) {
      setError(authErrorMessage(verifyError));
      setShakeKey((k) => k + 1);
      setCode('');
    }
    // On success a session exists and the session provider moves to the account status screen.
  }

  async function resend() {
    setError(null);
    setInfo(null);
    setCooldown(RESEND_SECONDS);
    const { error: resendError } = await supabase.auth.resend({ type: 'signup', email });
    if (resendError) {
      setError(authErrorMessage(resendError));
      return;
    }
    setInfo('We sent a new code.');
  }

  function onChangeCode(digits: string) {
    setCode(digits);
    if (error) setError(null);
    if (digits.length === 6) verify(digits);
  }

  return (
    <AuthScreen
      title="Check your email"
      subtitle={`Enter the 6-digit code we sent to ${email}. It expires in 10 minutes.`}
      footer={
        <Text style={styles.footer} onPress={() => router.dismissTo('/sign-in')} accessibilityRole="link">
          Use a different email
        </Text>
      }>
      <Reveal order={2}>
        <CodeInput value={code} onChange={onChangeCode} shakeKey={shakeKey} disabled={verifying} />
      </Reveal>
      <FormMessage message={error} />
      <FormMessage message={info} tone="info" />
      <Reveal order={3}>
        <Button label="Confirm email" onPress={() => verify(code)} loading={verifying} />
      </Reveal>
      <Reveal order={4}>
        <Button
          label={cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
          onPress={resend}
          variant="quiet"
          disabled={cooldown > 0}
        />
      </Reveal>
    </AuthScreen>
  );
}

const useStyles = createThemedStyles((t) => ({
  footer: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
}));
