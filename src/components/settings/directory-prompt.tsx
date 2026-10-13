import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { AddressBookIcon } from 'phosphor-react-native/src/icons/AddressBook';

import { Button } from '@/components/ui/button';
import { loadDirectory, setConsent, type Directory } from '@/lib/privacy';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// Asked once, after joining a batch: appear in the batch directory? Yes and Not now weigh the same
// (no nudging), and either answer is recorded so it is not asked again.
export function DirectoryPrompt() {
  const theme = useTheme();
  const styles = useStyles();
  const [d, setD] = useState<Directory | null>(null);
  const [answered, setAnswered] = useState<boolean | null>(null);

  useEffect(() => {
    loadDirectory().then((r) => setD(r.data));
  }, []);

  async function answer(yes: boolean) {
    setAnswered(yes);
    await setConsent('batch_directory', yes, 'prompt');
  }

  if (!d) return null;

  return (
    <View style={styles.card}>
      {d.asked || answered !== null ? (
        <>
          <Text style={styles.body}>
            {(answered ?? d.listed)
              ? 'You are in your batch directory.'
              : 'You are not in your batch directory. Change it any time in Privacy and consent.'}
          </Text>
          <Button label="See people in your batch" variant="quiet" onPress={() => router.push('/batch-directory')} />
        </>
      ) : (
        <>
          <View style={styles.head}>
            <AddressBookIcon size={22} weight="bold" color={theme.onAccentTint} />
            <Text style={styles.title}>Appear in your batch directory?</Text>
          </View>
          <Text style={styles.body}>
            Batchmates who say yes see each other in a list, to find people from their batch. Change it any time.
          </Text>
          <View style={styles.buttons}>
            <View style={styles.button}>
              <Button label="Yes" variant="quiet" onPress={() => answer(true)} />
            </View>
            <View style={styles.button}>
              <Button label="Not now" variant="quiet" onPress={() => answer(false)} />
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  card: { backgroundColor: t.accentTint, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 16, color: t.onAccentTint },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.onAccentTint },
  buttons: { flexDirection: 'row', gap: space.sm },
  button: { flex: 1 },
}));
