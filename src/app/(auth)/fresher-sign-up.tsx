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

// Freshers: selected by UGC, no university email yet. A personal email and the selection letter
// (uploaded next, after the code); the Uni Era team reads the letter and adds them to their batch.
export default function FresherSignUp() {
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
      email: emailError(address, 'your email address'),
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
        data: { fresher: true, age_confirmed: true, guidelines_accepted: true },
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
      title="Join as a fresher"
      subtitle="No university email yet? Use your own email. Next you upload your UGC selection letter, and the Uni Era team adds you to your batch."
      footer={
        <Text style={styles.footer}>
          Have a university email?{' '}
          <Link href="/sign-up" dismissTo style={styles.link}>
            Use it instead
          </Link>
        </Text>
      }>
      <Reveal order={2}>
        <TextField
          label="Your email"
          value={email}
          onChangeText={setEmail}
          error={fieldErrors.email}
          placeholder="you@gmail.com"
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
        <CheckRow label="I accept the community guidelines" checked={guidelinesAccepted} onChange={setGuidelinesAccepted} />
        <Text style={styles.guidelines} onPress={() => router.push('/guidelines')} accessibilityRole="link">
          Read the community guidelines
        </Text>
      </Reveal>
      <Reveal order={5}>
        <Text style={styles.notice}>
          Your letter is seen only by the Uni Era team and deleted once you add your university email. Until then you can chat
          with your batch, read posts and share files, but not post or use the Shop.
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
  guidelines: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.accentText, paddingLeft: 34, paddingVertical: 2 },
  notice: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.textMuted },
  footer: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: t.textMuted },
  link: { fontFamily: fonts.bodyBold, color: t.text },
}));
