import { AuthChrome } from '@/components/auth/auth-chrome';
import { AuthScreen } from '@/components/auth/auth-screen';
import { UniversityEmailForm } from '@/components/freshers/university-email-form';
import { Button } from '@/components/ui/button';
import { signOut } from '@/lib/sign-out';

// A fresher's 120 days are over without a university email. Nothing is lost: adding the email
// opens everything again, exactly as they left it.
export default function FresherExpired() {
  return (
    <AuthChrome>
      <AuthScreen
        title="Add your university email to continue"
        subtitle="Fresher accounts last 120 days. Your chats and batch are waiting; add your university email to carry on. If your university has not given you one yet, contact the Uni Era team."
        footer={<Button label="Sign out" variant="quiet" onPress={() => signOut()} />}>
        <UniversityEmailForm />
      </AuthScreen>
    </AuthChrome>
  );
}
