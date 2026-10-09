import { Link, router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View, type TextInput } from 'react-native';

import { AuthScreen } from '@/components/auth/auth-screen';
import { Button } from '@/components/ui/button';
import { CheckRow } from '@/components/ui/check-row';
import { FormMessage } from '@/components/ui/form-message';
import { TextField } from '@/components/ui/text-field';
import { authErrorMessage } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';
import { emailError, fullNameError, newPasswordError, normaliseEmail } from '@/lib/validation';
import { colors, fonts, space } from '@/theme/tokens';

type FieldErrors = { fullName?: string | null; email?: string | null; password?: string | null };

export default function SignUp() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [guidelinesAccepted, setGuidelinesAccepted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  async function createAccount() {
    const address = normaliseEmail(email);
    const errors: FieldErrors = {
      fullName: fullNameError(fullName),
      email: emailError(address),
      password: newPasswordError(password),
    };
    setFieldErrors(errors);
    if (errors.fullName || errors.email || errors.password) {
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
        data: { full_name: fullName.trim(), age_confirmed: true, guidelines_accepted: true },
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
      title="Create your account"
      subtitle="Use your university student email. A moderator checks every new account so Gansiya stays students-only."
      footer={
        <Text style={styles.footer}>
          Already have an account?{' '}
          <Link href="/sign-in" style={styles.link}>
            Sign in
          </Link>
        </Text>
      }>
      <TextField
        label="Full name"
        value={fullName}
        onChangeText={setFullName}
        error={fieldErrors.fullName}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => emailRef.current?.focus()}
      />
      <TextField
        ref={emailRef}
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
      <View style={styles.checks}>
        <CheckRow label="I am 18 or older" checked={ageConfirmed} onChange={setAgeConfirmed} />
        <CheckRow
          label="I accept the community guidelines"
          checked={guidelinesAccepted}
          onChange={setGuidelinesAccepted}
        />
      </View>
      <Text style={styles.notice}>
        We only use your email to check you are a student and to sign you in. See the privacy notice for
        what we store and why.
      </Text>
      <FormMessage message={error} />
      <Button label="Create account" onPress={createAccount} loading={loading} />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  checks: { gap: space.xs },
  notice: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.onInkMuted },
  footer: { fontFamily: fonts.body, fontSize: 15, color: colors.onInkMuted },
  link: { fontFamily: fonts.bodyBold, color: colors.white },
});
