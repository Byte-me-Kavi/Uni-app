import { useEffect, useState } from 'react';
import { AppState, Text } from 'react-native';

import { AuthChrome } from '@/components/auth/auth-chrome';
import { AuthScreen } from '@/components/auth/auth-screen';
import { Reveal } from '@/components/motion/reveal';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';
import { createThemedStyles, fonts, radius, space } from '@/theme/tokens';

type Account = {
  full_name: string;
  name_confirmed: boolean;
  institution: { name: string } | null;
  last_review: { decision: string; reason: string | null } | null;
};

export default function AccountStatus() {
  const styles = useStyles();
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
      setMessage('Still waiting for approval. We will let you in as soon as the Uni Era team approves you.');
    }
  }

  const institution = account?.institution?.name ?? 'your university';
  const reason = account?.last_review?.reason;
  // Before approval the name is usually still the email placeholder (2023cs115): no greeting by it.
  const firstName = account?.name_confirmed ? account.full_name.split(' ')[0] : null;

  const copy = {
    pending: {
      title: firstName ? `Thanks, ${firstName}` : 'Thanks for signing up',
      body: `The Uni Era team checks every new account at ${institution} so Uni Era stays students-only. This usually takes less than a day.`,
    },
    rejected: {
      title: 'We could not approve this account',
      body: 'The Uni Era team reviewed your sign-up and could not confirm you are a student here.',
    },
    suspended: {
      title: 'This account is suspended',
      body: 'The Uni Era team suspended this account for breaking the community guidelines.',
    },
    active: { title: 'You are in', body: 'Opening Uni Era...' },
  }[status];

  return (
    <AuthChrome waiting={status === 'pending'}>
      <AuthScreen
        title={copy.title}
        subtitle={copy.body}
        footer={<Button label="Sign out" variant="quiet" onPress={() => supabase.auth.signOut()} />}>
        {reason && status !== 'pending' ? (
          <Reveal order={2} style={styles.reason}>
            <Text style={styles.reasonLabel}>Reason</Text>
            <Text style={styles.reasonText}>{reason}</Text>
          </Reveal>
        ) : null}
        {status === 'pending' ? (
          <>
            <FormMessage message={message} tone="info" />
            <Reveal order={2}>
              <Button label="Check again" onPress={checkAgain} loading={checking} />
            </Reveal>
          </>
        ) : (
          <Reveal order={3}>
            <Text style={styles.help}>
              If you think this is a mistake, contact the Uni Era team from your university email.
            </Text>
          </Reveal>
        )}
      </AuthScreen>
    </AuthChrome>
  );
}

const useStyles = createThemedStyles((t) => ({
  reason: { backgroundColor: t.surface, borderRadius: radius.md, padding: space.lg, gap: space.xs },
  reasonLabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.textMuted },
  reasonText: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 21, color: t.text },
  help: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted },
}));
