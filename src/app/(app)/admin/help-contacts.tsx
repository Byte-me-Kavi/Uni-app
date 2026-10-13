import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { KeyboardFrame, KeyboardScroll } from '@/components/ui/keyboard';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { KIND_TITLE, loadAllHelpContacts, saveHelpContacts, type Contact, type ContactKind } from '@/lib/help';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

const KINDS: ContactKind[] = ['ragging', 'security', 'wellbeing', 'emergency'];
const BLANK: Contact = { kind: 'ragging', label: '' };

// Which list is open: the national one, or a university's by id.
type Scope = 'national' | number;

// Uni Era team (national admins): the help contacts students see under Get help and after reporting
// ragging. The national list and each university's. Check every number before saving: a wrong
// number is worse than none.
export default function HelpContactsEditor() {
  const theme = useTheme();
  const styles = useStyles();
  const [scope, setScope] = useState<Scope>('national');
  const [universities, setUniversities] = useState<{ id: number; name: string }[]>([]);
  const [lists, setLists] = useState<Record<string, Contact[]> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAllHelpContacts().then((r) => {
      if (!r.data) return setError(r.error);
      setUniversities(r.data.universities.map((u) => ({ id: u.id, name: u.name })));
      setLists(
        Object.fromEntries([['national', r.data.national], ...r.data.universities.map((u) => [String(u.id), u.contacts])]),
      );
    });
  }, []);

  if (!lists) {
    return (
      <Screen style={styles.screen}>
        <BackHeader title="Help contacts" />
        <View style={styles.center}>
          {error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} />}
        </View>
      </Screen>
    );
  }

  const key = String(scope);
  const list = lists[key] ?? [];
  const setList = (next: Contact[]) => setLists({ ...lists, [key]: next });
  const update = (i: number, patch: Partial<Contact>) => setList(list.map((c, n) => (n === i ? { ...c, ...patch } : c)));
  const choose = (s: Scope) => {
    setScope(s);
    setError(null);
    setSaved(null);
  };

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(null);
    const clean = list.map((c) => ({
      kind: c.kind,
      label: c.label,
      ...(c.phone?.trim() ? { phone: c.phone.trim() } : {}),
      ...(c.email?.trim() ? { email: c.email.trim() } : {}),
      ...(c.url?.trim() ? { url: c.url.trim() } : {}),
      ...(c.note?.trim() ? { note: c.note.trim() } : {}),
    }));
    const r = await saveHelpContacts(scope === 'national' ? null : scope, clean);
    setSaving(false);
    if (r.error !== null) return setError(r.error);
    setList(r.data);
    setSaved('Saved. Students see the new contacts straight away.');
  }

  const scopes: { key: Scope; label: string }[] = [
    { key: 'national', label: 'Everyone' },
    ...universities.map((u) => ({ key: u.id, label: u.name })),
  ];

  return (
    <Screen style={styles.screen} edges={['top']}>
      <BackHeader title="Help contacts" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scopeBar}
        contentContainerStyle={styles.scopes}
        accessibilityRole="tablist">
        {scopes.map((s) => (
          <PressableScale
            key={String(s.key)}
            onPress={() => choose(s.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: scope === s.key }}
            style={[styles.tab, scope === s.key && styles.tabOn]}>
            <Text style={[styles.tabText, scope === s.key && styles.tabTextOn]}>{s.label}</Text>
          </PressableScale>
        ))}
      </ScrollView>
      <KeyboardFrame style={styles.flex}>
        <KeyboardScroll contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.lead}>
            {scope === 'national'
              ? 'Shown to every student, after their university’s own contacts.'
              : 'Shown only to students at this university, above the national ones.'}{' '}
            Call or email each one before saving. A wrong number at the moment someone needs help is worse than no number.
          </Text>

          {list.length === 0 ? <Text style={styles.empty}>No contacts here yet.</Text> : null}

          {list.map((c, i) => (
            <View key={`${key}-${i}`} style={styles.card}>
              <View style={styles.tabs}>
                {KINDS.map((k) => (
                  <PressableScale
                    key={k}
                    onPress={() => update(i, { kind: k })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: c.kind === k }}
                    style={[styles.chip, c.kind === k && styles.tabOn]}>
                    <Text style={[styles.chipText, c.kind === k && styles.tabTextOn]}>{KIND_TITLE[k]}</Text>
                  </PressableScale>
                ))}
              </View>
              <TextField
                label="Name"
                value={c.label}
                onChangeText={(v) => update(i, { label: v })}
                placeholder="e.g. Anti-ragging committee"
              />
              <TextField
                label="Phone"
                value={c.phone ?? ''}
                onChangeText={(v) => update(i, { phone: v })}
                keyboardType="phone-pad"
              />
              <TextField
                label="Email"
                value={c.email ?? ''}
                onChangeText={(v) => update(i, { email: v })}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <TextField
                label="Link (https)"
                value={c.url ?? ''}
                onChangeText={(v) => update(i, { url: v })}
                autoCapitalize="none"
              />
              <TextField
                label="Note (optional)"
                value={c.note ?? ''}
                onChangeText={(v) => update(i, { note: v })}
                placeholder="e.g. Weekdays 8 am to 4 pm"
              />
              <Button label="Remove" variant="quiet" onPress={() => setList(list.filter((_, n) => n !== i))} />
            </View>
          ))}
          {list.length < 8 ? (
            <Button label="Add a contact" variant="quiet" onPress={() => setList([...list, { ...BLANK }])} />
          ) : null}
          <FormMessage message={error} />
          <FormMessage message={saved} tone="info" />
          <Button label="Save" loading={saving} onPress={save} />
          <Button label="Done" variant="quiet" onPress={() => router.back()} />
        </KeyboardScroll>
      </KeyboardFrame>
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  content: { padding: space.xl, paddingTop: space.sm, gap: space.md, width: '100%', maxWidth: 560, alignSelf: 'center' },
  lead: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.text },
  empty: { fontFamily: fonts.body, fontSize: 15, color: t.textMuted },
  scopeBar: { flexGrow: 0 },
  scopes: { gap: space.sm, paddingHorizontal: space.xl, paddingBottom: space.sm },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tab: { paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: t.surface },
  tabOn: { backgroundColor: t.focus },
  tabText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  tabTextOn: { color: t.background },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.md, gap: space.sm },
  chip: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: t.background },
  chipText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: t.text },
}));
