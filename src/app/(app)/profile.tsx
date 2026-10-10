import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { CaretLeftIcon } from 'phosphor-react-native/src/icons/CaretLeft';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { supabase } from '@/lib/supabase';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Account = {
  full_name: string;
  email: string;
  institution: { name: string } | null;
  staff_role: 'admin' | 'moderator' | null;
};

const ROLE_LABEL = { admin: 'Admin', moderator: 'Moderator' } as const;

export default function Profile() {
  const theme = useTheme();
  const styles = useStyles();
  const [account, setAccount] = useState<Account | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    supabase.rpc('my_account').then(({ data }) => setAccount((data as Account | null) ?? null));
  }, []);

  async function signOut() {
    setSigningOut(true);
    // Signs out this device only; other devices stay signed in.
    await supabase.auth.signOut({ scope: 'local' });
  }

  return (
    <Screen style={styles.safe}>
      <View style={styles.topBar}>
        <PressableScale
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          style={styles.back}>
          <CaretLeftIcon size={22} weight="bold" color={theme.text} />
        </PressableScale>
        <Text style={styles.title} accessibilityRole="header">
          Account
        </Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {account ? (
          <View style={styles.identity}>
            <Avatar name={account.full_name} size={76} />
            <Text style={styles.name}>{account.full_name}</Text>
            <Text style={styles.email}>{account.email}</Text>
            {account.staff_role ? <Text style={styles.role}>{ROLE_LABEL[account.staff_role]}</Text> : null}
          </View>
        ) : (
          <View style={[styles.identity, styles.placeholder]} />
        )}

        <View style={styles.list}>
          <Row label="University" value={account?.institution?.name ?? ' '} />
          <Row label="Appearance" value="Follows your phone's light or dark mode" />
        </View>

        <Button label="Sign out" variant="quiet" onPress={signOut} loading={signingOut} />
      </ScrollView>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  safe: { flex: 1, backgroundColor: t.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    minHeight: 56,
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  content: { padding: space.xl, gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  identity: { alignItems: 'center', gap: space.xs, paddingVertical: space.lg },
  placeholder: { height: 168 },
  name: { fontFamily: fonts.display, fontSize: 24, color: t.text, marginTop: space.md, textAlign: 'center' },
  email: { fontFamily: fonts.body, fontSize: 15, color: t.textMuted, textAlign: 'center' },
  role: {
    marginTop: space.sm,
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: t.text,
    backgroundColor: t.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  list: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg, gap: space.lg },
  row: { gap: 2 },
  rowLabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.textMuted },
  rowValue: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: t.text },
}));
