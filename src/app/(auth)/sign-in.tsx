import { Link, router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, type TextInput } from 'react-native';

import { AuthScreen } from '@/components/auth/auth-screen';
import { Reveal } from '@/components/motion/reveal';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { TextField } from '@/components/ui/text-field';
import { authErrorMessage, isEmailNotConfirmed } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';
import { emailError, normaliseEmail } from '@/lib/validation';
import { createThemedStyles, fonts } from '@/theme/tokens';

export default function SignIn() {
  const styles = useStyles();
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
      subtitle="Sign in with the email you signed up with."
      footer={
        <Text style={styles.footer}>
          New to Uni Era?{' '}
          <Link href="/sign-up" style={styles.link}>
            Create an account
          </Link>
          {'\n'}
          No university email yet?{' '}
          <Link href="/fresher-sign-up" style={styles.link}>
            Join as a fresher
          </Link>
        </Text>
      }>
      <Reveal order={2}>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@email.com"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="username"
          keyboardType="email-address"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
      </Reveal>
      <Reveal order={3}>
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
      </Reveal>
      <FormMessage message={error} />
      <Reveal order={4}>
        <Button label="Sign in" onPress={signIn} loading={loading} />
      </Reveal>
    </AuthScreen>
  );
}

const useStyles = createThemedStyles((t) => ({
  footer: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 26, color: t.textMuted, textAlign: 'center' },
  link: { fontFamily: fonts.bodyBold, color: t.text },
}));
