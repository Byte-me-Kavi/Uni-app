import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';

import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { supabase } from '@/lib/supabase';
import { useAccount } from '@/lib/use-account';
import { createThemedStyles, fonts, space } from '@/theme/tokens';

const MAX = 280;

// A short line about yourself, shown on your card and under your name.
export default function About() {
  const styles = useStyles();
  const { account } = useAccount();
  const [bio, setBio] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start from the saved bio once it loads; after that the field is the student's.
  useEffect(() => {
    if (account && bio === null) setBio(account.bio ?? '');
  }, [account, bio]);

  const text = bio ?? '';
  const left = MAX - text.trim().length;

  async function save() {
    if (left < 0) return;
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('update_bio', { p_bio: text });
    setSaving(false);
    if (saveError) {
      setError(saveError.code === '22023' ? saveError.message : 'Could not save. Check your connection and try again.');
      return;
    }
    router.back();
  }

  return (
    <Screen style={styles.screen}>
      <BackHeader title="About you" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.lead}>
            A line or two so students know who you are: your course, interests, what you can help with.
          </Text>
          <TextField
            label="About you"
            value={text}
            onChangeText={setBio}
            editable={bio !== null}
            multiline
            maxLength={MAX + 40}
            placeholder="Second year CS. Into robotics, happy to help with maths kuppi."
            hint={left >= 0 ? `${left} characters left` : undefined}
            error={left < 0 ? `${-left} characters over the limit` : null}
            style={styles.input}
            textAlignVertical="top"
          />
          <FormMessage message={error} />
          <Button label="Save" onPress={save} loading={saving} disabled={bio === null || left < 0} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  flex: { flex: 1 },
  content: { padding: space.xl, paddingTop: space.sm, gap: space.lg, width: '100%', maxWidth: 560, alignSelf: 'center' },
  lead: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: t.textMuted },
  input: { minHeight: 120, paddingTop: space.md },
}));
