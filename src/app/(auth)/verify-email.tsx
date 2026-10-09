import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { AuthScreen } from '@/components/auth/auth-screen';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { TextField } from '@/components/ui/text-field';
import { authErrorMessage } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';
import { colors, fonts } from '@/theme/tokens';

const RESEND_SECONDS = 60;

export default function VerifyEmail() {
  const params = useLocalSearchParams<{ email?: string; resend?: string }>();
  const email = params.email ?? '';
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
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
      return;
    }
    setVerifying(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    setVerifying(false);
    if (verifyError) {
      setError(authErrorMessage(verifyError));
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

  function onChangeCode(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (digits.length === 6) verify(digits);
  }

  return (
    <AuthScreen
      title="Check your email"
      subtitle={`We sent a 6-digit code to ${email}. It expires in 10 minutes.`}
      footer={
        <Text style={styles.footer} onPress={() => router.replace('/sign-in')} accessibilityRole="link">
          Use a different email
        </Text>
      }>
      <TextField
        label="Code"
        value={code}
        onChangeText={onChangeCode}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        autoFocus
        style={styles.code}
      />
      <FormMessage message={error} />
      <FormMessage message={info} tone="info" />
      <Button label="Confirm email" onPress={() => verify(code)} loading={verifying} />
      <Button
        label={cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
        onPress={resend}
        variant="quiet"
        disabled={cooldown > 0}
      />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  code: { fontFamily: fonts.bodyBold, fontSize: 24, letterSpacing: 8 },
  footer: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.white },
});
