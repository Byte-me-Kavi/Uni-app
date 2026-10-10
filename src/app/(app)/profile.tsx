import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { CaretLeftIcon } from 'phosphor-react-native/src/icons/CaretLeft';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { supabase } from '@/lib/supabase';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Findable = 'everyone' | 'my_institution' | 'nobody';

type Account = {
  full_name: string;
  email: string;
  institution: { name: string } | null;
  staff_role: 'admin' | 'moderator' | null;
  findable_by: Findable;
};

const FINDABLE: { value: Findable; label: string; detail: string }[] = [
  { value: 'everyone', label: 'Every university', detail: 'Any verified student can find you by name' },
  { value: 'my_institution', label: 'My university', detail: 'Only students at your university' },
  { value: 'nobody', label: 'No one', detail: 'You do not appear in search' },
];

const ROLE_LABEL = { admin: 'Admin', moderator: 'Moderator' } as const;

export default function Profile() {
  const theme = useTheme();
  const styles = useStyles();
  const [account, setAccount] = useState<Account | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [findableError, setFindableError] = useState(false);

  useEffect(() => {
    supabase.rpc('my_account').then(({ data }) => setAccount((data as Account | null) ?? null));
  }, []);

  // Shows the choice at once and puts it back if the server refuses.
  async function setFindable(value: Findable) {
    if (!account || account.findable_by === value) return;
    const previous = account.findable_by;
    setAccount({ ...account, findable_by: value });
    setFindableError(false);
    const { error } = await supabase.rpc('set_findable_by', { p_findable_by: value });
    if (error) {
      setAccount((a) => (a ? { ...a, findable_by: previous } : a));
      setFindableError(true);
    }
  }

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

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Who can find you in search</Text>
          <View style={styles.options} accessibilityRole="radiogroup">
            {FINDABLE.map((option) => {
              const selected = account?.findable_by === option.value;
              return (
                <PressableScale
                  key={option.value}
                  onPress={() => setFindable(option.value)}
                  disabled={!account}
                  scale={0.985}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: !account }}
                  accessibilityLabel={`${option.label}. ${option.detail}`}
                  style={[styles.option, selected && styles.optionSelected]}>
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected ? <View style={styles.radioDot} /> : null}
                  </View>
                  <View style={styles.optionText}>
                    <Text style={styles.optionLabel}>{option.label}</Text>
                    <Text style={styles.optionDetail}>{option.detail}</Text>
                  </View>
                </PressableScale>
              );
            })}
          </View>
          {findableError ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              Could not change this. Check your connection and try again.
            </Text>
          ) : (
            <Text style={styles.sectionNote}>Search shows your name, university and batch. Never your email.</Text>
          )}
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
  section: { gap: space.md },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  sectionNote: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
  error: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 19, color: t.dangerText },
  options: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.xs, gap: 2 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  optionSelected: { borderColor: t.focus, backgroundColor: t.background },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: t.borderFilled,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Selected: red with an Ink centre (brand rule: what is on red is Ink).
  radioSelected: { borderColor: brand.red, backgroundColor: brand.red },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: brand.ink },
  optionText: { flex: 1, gap: 1 },
  optionLabel: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  optionDetail: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
}));
