import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { DownloadSimpleIcon } from 'phosphor-react-native/src/icons/DownloadSimple';
import { TrashIcon } from 'phosphor-react-native/src/icons/Trash';

import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { KeyboardFrame } from '@/components/ui/keyboard';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { downloadMyData, requestDeletion } from '@/lib/account-data';
import { dayMonth } from '@/lib/dates';
import { signOut } from '@/lib/sign-out';
import { useSession } from '@/providers/session-provider';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

const GOES = [
  'Your profile, photo and sign-in',
  'Your posts, comments, listings and shared files',
  'Your direct chats, for both of you',
  'Your selection letter, if you joined as a fresher',
];
const STAYS = [
  'Messages you sent in groups, shown as from "Deleted account", so conversations still make sense',
  'Reports and moderation records, kept for safety without your name',
];

// Account, Your data: download a copy of everything, or delete the account.
export default function YourData() {
  const theme = useTheme();
  const styles = useStyles();
  const session = useSession();
  const email = session.status === 'signed_in' ? (session.session.user.email ?? '') : '';
  const [downloading, setDownloading] = useState(false);
  const [downloadNote, setDownloadNote] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The day it would be deleted, fixed when the screen opens.
  const [deleteDay] = useState(() => new Date(Date.now() + 30 * 86_400_000));

  async function download() {
    setDownloading(true);
    setDownloadNote(null);
    const failed = await downloadMyData();
    setDownloading(false);
    setDownloadNote(failed);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const r = await requestDeletion(typed);
    if ('error' in r) {
      setBusy(false);
      setError(r.error);
      return;
    }
    // Signed out everywhere, with this phone wiped; signing back in before the day offers to keep
    // the account.
    await signOut('global');
  }

  return (
    <Screen style={styles.screen} edges={['top']}>
      <BackHeader title="Your data" />
      <KeyboardFrame style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <View style={styles.head}>
              <DownloadSimpleIcon size={22} weight="bold" color={theme.text} />
              <Text style={styles.title}>Download your data</Text>
            </View>
            <Text style={styles.body}>
              One file with your account, posts, comments, the messages you sent, listings, orders, consents and anything the Uni
              Era team did on your account. It is made on your phone and saved where you choose.
            </Text>
            <FormMessage message={downloadNote} />
            <Button label="Download" variant="quiet" loading={downloading} onPress={download} />
          </View>

          <View style={[styles.card, styles.danger]}>
            <View style={styles.head}>
              <TrashIcon size={22} weight="bold" color={theme.dangerText} />
              <Text style={[styles.title, styles.dangerTitle]}>Delete your account</Text>
            </View>
            <Text style={styles.body}>Deleted 30 days from today, on {dayMonth(deleteDay)}. Sign in before then to keep it.</Text>
            <Text style={styles.label}>What goes</Text>
            {GOES.map((g) => (
              <Text key={g} style={styles.item}>
                {g}
              </Text>
            ))}
            <Text style={styles.label}>What stays</Text>
            {STAYS.map((g) => (
              <Text key={g} style={styles.item}>
                {g}
              </Text>
            ))}
            {deleting ? (
              <View style={styles.form}>
                <TextField
                  label={`Type ${email} to confirm`}
                  value={typed}
                  onChangeText={setTyped}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                />
                <FormMessage message={error} />
                <Button
                  label="Delete my account"
                  loading={busy}
                  disabled={typed.trim().toLowerCase() !== email.toLowerCase()}
                  onPress={remove}
                />
                <Button label="Keep my account" variant="quiet" onPress={() => setDeleting(false)} />
              </View>
            ) : (
              <Button label="Delete account" variant="quiet" onPress={() => setDeleting(true)} />
            )}
          </View>
        </ScrollView>
      </KeyboardFrame>
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  flex: { flex: 1 },
  content: { padding: space.xl, paddingTop: space.sm, gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  danger: { borderWidth: 1.5, borderColor: t.dangerText },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  dangerTitle: { color: t.dangerText },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.text },
  label: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.textMuted, marginTop: space.xs },
  item: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.text, paddingLeft: space.sm },
  form: { gap: space.sm, marginTop: space.sm },
}));
