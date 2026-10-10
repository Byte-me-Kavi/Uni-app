import { Link, router } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, type TextInput } from 'react-native';

import { AuthScreen } from '@/components/auth/auth-screen';
import { Reveal } from '@/components/motion/reveal';
import { Button } from '@/components/ui/button';
import { CheckRow } from '@/components/ui/check-row';
import { FormMessage } from '@/components/ui/form-message';
import { TextField } from '@/components/ui/text-field';
import { authErrorMessage } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';
import { emailError, newPasswordError, normaliseEmail } from '@/lib/validation';
import { createThemedStyles, fonts, space } from '@/theme/tokens';

type FieldErrors = { email?: string | null; password?: string | null };

export default function SignUp() {
  const styles = useStyles();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [guidelinesAccepted, setGuidelinesAccepted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  async function createAccount() {
    const address = normaliseEmail(email);
    const errors: FieldErrors = {
      email: emailError(address),
      password: newPasswordError(password),
    };
    setFieldErrors(errors);
    if (errors.email || errors.password) {
      setError(null);
      return;
    }
    if (!ageConfirmed || !guidelinesAccepted) {
      setError('Confirm you are 18 or older and accept the community guidelines.');
      return;
    }

    setLoading(true);
    setError(null);
    const { error: signUpError } = await supabase.auth.signUp({
      email: address,
      password,
      options: {
        // The name is chosen after approval, on the welcome screen.
        data: { age_confirmed: true, guidelines_accepted: true },
      },
    });
    setLoading(false);

    if (signUpError) {
      setError(authErrorMessage(signUpError));
      return;
    }
    router.replace({ pathname: '/verify-email', params: { email: address } });
  }

  return (
    <AuthScreen
      title="Start your uni era"
      subtitle="Use your university email. A moderator approves every new account, so Uni Era stays students-only."
      footer={
        <Text style={styles.footer}>
          Already have an account?{' '}
          <Link href="/sign-in" dismissTo style={styles.link}>
            Sign in
          </Link>
        </Text>
      }>
      <Reveal order={2}>
        <TextField
          label="University email"
          value={email}
          onChangeText={setEmail}
          error={fieldErrors.email}
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
      </Reveal>
      <Reveal order={3}>
        <TextField
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={setPassword}
          error={fieldErrors.password}
          hint="At least 10 characters, with letters and numbers."
          secret
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="done"
        />
      </Reveal>
      <Reveal order={4} style={styles.checks}>
        <CheckRow label="I am 18 or older" checked={ageConfirmed} onChange={setAgeConfirmed} />
        <CheckRow
          label="I accept the community guidelines"
          checked={guidelinesAccepted}
          onChange={setGuidelinesAccepted}
        />
      </Reveal>
      <Reveal order={5}>
        <Text style={styles.notice}>
          We only use your email to check you are a student and to sign you in. See the privacy notice for
          what we store and why.
        </Text>
      </Reveal>
      <FormMessage message={error} />
      <Reveal order={6}>
        <Button label="Create account" onPress={createAccount} loading={loading} />
      </Reveal>
    </AuthScreen>
  );
}

const useStyles = createThemedStyles((t) => ({
  checks: { gap: space.xs },
  notice: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.textMuted },
  footer: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: t.textMuted },
  link: { fontFamily: fonts.bodyBold, color: t.text },
}));
