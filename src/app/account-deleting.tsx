import { useState } from 'react';

import { AuthChrome } from '@/components/auth/auth-chrome';
import { AuthScreen } from '@/components/auth/auth-screen';
import { Reveal } from '@/components/motion/reveal';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { cancelDeletion } from '@/lib/account-data';
import { dayMonth } from '@/lib/dates';
import { signOut } from '@/lib/sign-out';
import { useSession } from '@/providers/session-provider';

// Signed in while the account is waiting to be deleted: keep it (one tap), or sign out and let it go.
export default function AccountDeleting() {
  const session = useSession();
  const at = session.status === 'signed_in' ? session.claims.deletingAt : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function keep() {
    setBusy(true);
    setError(null);
    const failed = await cancelDeletion();
    setBusy(false);
    if (failed) setError(failed);
  }

  return (
    <AuthChrome>
      <AuthScreen
        title="Your account is being deleted"
        subtitle={`It will be deleted on ${at ? dayMonth(new Date(at)) : 'the day you chose'}. Keep it and everything stays as it was.`}
        footer={<Button label="Sign out" variant="quiet" onPress={() => signOut()} />}>
        <Reveal order={2}>
          <Button label="Keep my account" onPress={keep} loading={busy} />
        </Reveal>
        <FormMessage message={error} />
      </AuthScreen>
    </AuthChrome>
  );
}
