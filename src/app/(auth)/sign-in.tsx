import { Link, router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, type TextInput } from 'react-native';

import { AuthScreen } from '@/components/auth/auth-screen';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { TextField } from '@/components/ui/text-field';
import { authErrorMessage, isEmailNotConfirmed } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';
import { emailError, normaliseEmail } from '@/lib/validation';
import { colors, fonts } from '@/theme/tokens';

export default function SignIn() {
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  async function signIn() {
    const address = normaliseEmail(email);
    const invalid = emailError(address) ?? (password ? null : 'Enter your password.');
    if (invalid) {
      setError(invalid);
      return;
    }

    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: address, password });
    setLoading(false);

    if (signInError) {
      if (isEmailNotConfirmed(signInError)) {
        router.push({ pathname: '/verify-email', params: { email: address, resend: '1' } });
        return;
      }
      setError(authErrorMessage(signInError));
    }
    // On success the session provider switches to the right screen.
  }

  return (
    <AuthScreen
      title="Welcome back"
      subtitle="Sign in with your university email."
      footer={
        <Text style={styles.footer}>
          New to Gansiya?{' '}
          <Link href="/sign-up" style={styles.link}>
            Create an account
          </Link>
        </Text>
      }>
      <TextField
        label="University email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@stu.university.ac.lk"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="username"
        keyboardType="email-address"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <TextField
        ref={passwordRef}
        label="Password"
        value={password}
        onChangeText={setPassword}
        secret
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={signIn}
      />
      <FormMessage message={error} />
      <Button label="Sign in" onPress={signIn} loading={loading} />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  footer: { fontFamily: fonts.body, fontSize: 15, color: colors.onInkMuted },
  link: { fontFamily: fonts.bodyBold, color: colors.white },
});
