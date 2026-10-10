import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { AuthChrome } from '@/components/auth/auth-chrome';
import { AuthScreen } from '@/components/auth/auth-screen';
import { Reveal } from '@/components/motion/reveal';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { TextField } from '@/components/ui/text-field';
import { supabase } from '@/lib/supabase';
import { fullNameError } from '@/lib/validation';
import { createThemedStyles, fonts } from '@/theme/tokens';

type Account = { full_name: string; email: string };

// First launch after a moderator approves the account: the student chooses the name other students
// will see. Saving it refreshes the access token, whose name_confirmed claim then opens the app.
export default function Welcome() {
  const styles = useStyles();
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Accounts created by the team may already carry a name: offer it. A placeholder taken from the
  // email (2023cs115) is not a name, so the field starts empty then.
  useEffect(() => {
    supabase.rpc('my_account').then(({ data }) => {
      const account = data as Account | null;
      if (!account) return;
      const local = account.email.split('@')[0]?.toLowerCase();
      if (account.full_name.toLowerCase() !== local) setName((current) => current || account.full_name);
    });
  }, []);

  async function save() {
    const problem = fullNameError(name);
    setFieldError(problem);
    if (problem) return;

    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('set_my_name', { p_full_name: name });
    if (saveError) {
      setSaving(false);
      setError(saveError.code === '22023' ? saveError.message : 'Could not save your name. Check your connection and try again.');
      return;
    }
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      setSaving(false);
      setError('Your name is saved. Close and reopen the app to continue.');
    }
    // On success the navigator swaps this screen for the app; nothing else to do here.
  }

  return (
    <AuthChrome>
      <AuthScreen
        title="You're in"
        subtitle="A moderator approved your account. Tell students what to call you: your name as it is at your university.">
        <Reveal order={2}>
          <TextField
            label="Your name"
            value={name}
            onChangeText={setName}
            error={fieldError}
            hint="Shown in search, chats and your batch. You set it once; a moderator can change it later."
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            returnKeyType="done"
            maxLength={80}
            onSubmitEditing={save}
          />
        </Reveal>
        <FormMessage message={error} />
        <Reveal order={3}>
          <Button label="Continue" onPress={save} loading={saving} />
        </Reveal>
        <Reveal order={4}>
          <Text style={styles.note}>Use your real name so your batchmates can find you.</Text>
        </Reveal>
      </AuthScreen>
    </AuthChrome>
  );
}

const useStyles = createThemedStyles((t) => ({
  note: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
}));
