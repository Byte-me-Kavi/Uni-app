import { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import { AuthScreen } from '@/components/auth/auth-screen';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';
import { colors, fonts, radius, space } from '@/theme/tokens';

type Account = {
  full_name: string;
  institution: { name: string } | null;
  last_review: { decision: string; reason: string | null } | null;
};

export default function AccountStatus() {
  const session = useSession();
  const status = session.status === 'signed_in' ? session.claims.accountStatus : 'pending';
  const [account, setAccount] = useState<Account | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc('my_account').then(({ data }) => setAccount((data as Account | null) ?? null));
  }, [status]);

  // Coming back to the app is the most likely moment the account was approved: refresh the token
  // so its claims (and so the screen) update without the student doing anything.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') supabase.auth.refreshSession();
    });
    return () => sub.remove();
  }, []);

  async function checkAgain() {
    setChecking(true);
    setMessage(null);
    const { error } = await supabase.auth.refreshSession();
    setChecking(false);
    if (error) {
      setMessage('Could not check right now. Try again in a moment.');
    } else if (status === 'pending') {
      setMessage('Still waiting for a moderator. We will let you in as soon as you are approved.');
    }
  }

  const institution = account?.institution?.name ?? 'your university';
  const reason = account?.last_review?.reason;
  const firstName = account?.full_name.split(' ')[0];

  const copy = {
    pending: {
      title: firstName ? `Thanks, ${firstName}` : 'Thanks for signing up',
      body: `A moderator at ${institution} checks every new account so Gansiya stays students-only. This usually takes less than a day.`,
    },
    rejected: {
      title: 'We could not approve this account',
      body: 'A moderator reviewed your sign-up and could not confirm you are a student here.',
    },
    suspended: {
      title: 'This account is suspended',
      body: 'A moderator suspended this account for breaking the community guidelines.',
    },
    active: { title: 'You are in', body: 'Opening Gansiya...' },
  }[status];

  return (
    <AuthScreen
      title={copy.title}
      subtitle={copy.body}
      footer={<Button label="Sign out" variant="quiet" onPress={() => supabase.auth.signOut()} />}>
      {reason && status !== 'pending' ? (
        <View style={styles.reason}>
          <Text style={styles.reasonLabel}>Reason</Text>
          <Text style={styles.reasonText}>{reason}</Text>
        </View>
      ) : null}
      {status === 'pending' ? (
        <>
          <FormMessage message={message} tone="info" />
          <Button label="Check again" onPress={checkAgain} loading={checking} />
        </>
      ) : (
        <Text style={styles.help}>
          If you think this is a mistake, contact the Gansiya team from your university email.
        </Text>
      )}
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  reason: { backgroundColor: colors.inkRaised, borderRadius: radius.md, padding: space.lg, gap: space.xs },
  reasonLabel: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.onInkMuted },
  reasonText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.white },
  help: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.onInkMuted },
});
