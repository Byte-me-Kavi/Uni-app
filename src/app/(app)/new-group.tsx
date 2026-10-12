import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { CircleIcon } from 'phosphor-react-native/src/icons/Circle';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { XIcon } from 'phosphor-react-native/src/icons/X';

import { Avatar } from '@/components/ui/avatar';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { refreshChats } from '@/lib/chat/engine';
import { useChatState } from '@/lib/chat/store';
import { supabase } from '@/lib/supabase';
import { usePeopleSearch } from '@/lib/use-people-search';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Person = { user_id: string; full_name: string; avatar_path: string | null; detail: string | null };
type Skipped = { full_name: string | null; reason: 'full' | 'not_allowed' };
const MAX = 99; // others; 100 with you

// A new group (project group, lab group, study circle), or, with ?add=<chat>, more people for one.
// People you already chat with are suggested; search finds anyone at your university. Students
// at another university can be added once you have an accepted chat with them, and anyone who
// only accepts messages from their batch, or blocked you, is left out (the group never gets round
// their settings).
export default function NewGroup() {
  const theme = useTheme();
  const styles = useStyles();
  const { add } = useLocalSearchParams<{ add?: string }>();
  const adding = !!add;
  const chats = useChatState((s) => s.chats);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Person[]>([]);
  const [name, setName] = useState('');
  const [step, setStep] = useState<'people' | 'name'>('people');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = usePeopleSearch(query);

  // Before typing: the people from your direct chats.
  const suggested = useMemo<Person[]>(
    () =>
      chats
        .filter((c) => c.kind === 'direct' && !c.request && c.other_user_id)
        .map((c) => ({ user_id: c.other_user_id!, full_name: c.title ?? 'Student', avatar_path: c.other_avatar_path, detail: null })),
    [chats],
  );
  const results: Person[] = query.trim().length >= 2
    ? search.results
        .filter((p) => !p.blocked)
        .map((p) => ({
          user_id: p.user_id,
          full_name: p.full_name,
          avatar_path: p.avatar_path,
          detail: [p.programme, p.institution].filter(Boolean).join(' · ') || null,
        }))
    : suggested;
  const isPicked = (id: string) => picked.some((p) => p.user_id === id);

  function toggle(person: Person) {
    setError(null);
    if (isPicked(person.user_id)) setPicked((list) => list.filter((p) => p.user_id !== person.user_id));
    else if (picked.length >= MAX) setError('A group can have up to 100 members.');
    else setPicked((list) => [...list, person]);
  }

  const skippedText = (skipped: Skipped[]) => {
    if (!skipped.length) return null;
    const names = skipped.map((s) => s.full_name?.split(' ')[0] ?? 'Someone').join(', ');
    return skipped.some((s) => s.reason === 'full')
      ? `${names} could not be added: the group is full.`
      : `${names} could not be added. They only accept messages from some students, or you have not chatted yet.`;
  };

  async function finish() {
    setBusy(true);
    setError(null);
    const ids = picked.map((p) => p.user_id);
    const { data, error: failed } = adding
      ? await supabase.rpc('add_group_members', { p_conversation_id: add!, p_member_ids: ids })
      : await supabase.rpc('create_group', { p_title: name.trim(), p_member_ids: ids });
    setBusy(false);
    if (failed) {
      setError(failed.message);
      return;
    }
    const result = data as { conversation_id?: string; added: string[]; skipped: Skipped[] };
    await refreshChats();
    const note = skippedText(result.skipped);
    if (adding) {
      if (note && !result.added.length) {
        setError(note);
        return;
      }
      router.back();
      return;
    }
    // Into the new group (replacing this screen, so back goes to the chat list).
    router.replace({ pathname: '/chat/[id]', params: { id: result.conversation_id!, ...(note ? { note } : {}) } });
  }

  return (
    <Screen style={styles.screen}>
      <BackHeader title={adding ? 'Add members' : step === 'name' ? 'Name the group' : 'New group'} />

      {step === 'people' ? (
        <>
          <View style={styles.field}>
            <MagnifyingGlassIcon size={20} color={theme.textMuted} weight="bold" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search students by name"
              placeholderTextColor={theme.textMuted}
              autoCorrect={false}
              style={styles.input}
              selectionColor={theme.accent}
              cursorColor={theme.accent}
              accessibilityLabel="Search students by name"
            />
          </View>

          {picked.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipsBar}>
              {picked.map((p) => (
                <Pressable
                  key={p.user_id}
                  onPress={() => toggle(p)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${p.full_name}`}
                  style={styles.chip}>
                  <Avatar name={p.full_name} path={p.avatar_path} size={24} />
                  <Text style={styles.chipText} numberOfLines={1}>
                    {p.full_name.split(' ')[0]}
                  </Text>
                  <XIcon size={14} color={theme.textMuted} weight="bold" />
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <FlatList
            data={results}
            keyExtractor={(p) => p.user_id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <Text style={styles.section}>{query.trim().length >= 2 ? 'Students' : 'People you chat with'}</Text>
            }
            renderItem={({ item }) => {
              const chosen = isPicked(item.user_id);
              return (
                <Pressable
                  onPress={() => toggle(item)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: chosen }}
                  accessibilityLabel={item.full_name}
                  style={({ pressed }) => [styles.person, pressed && styles.pressed]}>
                  <Avatar name={item.full_name} path={item.avatar_path} size={44} />
                  <View style={styles.personText}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.full_name}
                    </Text>
                    {item.detail ? (
                      <Text style={styles.detail} numberOfLines={1}>
                        {item.detail}
                      </Text>
                    ) : null}
                  </View>
                  {chosen ? (
                    <CheckCircleIcon size={24} color={theme.tickRead} weight="fill" />
                  ) : (
                    <CircleIcon size={24} color={theme.textMuted} />
                  )}
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {query.trim().length >= 2
                  ? search.status === 'loading'
                    ? 'Searching…'
                    : 'Nobody found with that name.'
                  : 'Search for classmates by name to add them.'}
              </Text>
            }
          />
          <View style={styles.footer}>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              label={adding ? `Add ${picked.length || ''}`.trim() : picked.length ? `Next (${picked.length})` : 'Next'}
              disabled={!picked.length}
              loading={busy}
              onPress={() => (adding ? finish() : setStep('name'))}
            />
          </View>
        </>
      ) : (
        <View style={styles.nameStep}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Group name, e.g. CS2042 lab group"
            placeholderTextColor={theme.textMuted}
            autoFocus
            maxLength={80}
            style={styles.nameInput}
            selectionColor={theme.accent}
            cursorColor={theme.accent}
            accessibilityLabel="Group name"
          />
          <Text style={styles.detail}>
            With {picked.map((p) => p.full_name.split(' ')[0]).join(', ')}. You will be its admin.
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="Create group" disabled={!name.trim()} loading={busy} onPress={finish} />
          <Button label="Back to people" variant="quiet" onPress={() => setStep('people')} />
        </View>
      )}
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.sm,
    paddingHorizontal: space.md,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: t.surface,
  },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: t.text },
  chipsBar: { flexGrow: 0, marginTop: space.sm },
  chips: { paddingHorizontal: space.lg, gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 4,
    paddingRight: space.sm,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: t.surface,
    maxWidth: 160,
  },
  chipText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: t.text, flexShrink: 1 },
  list: { paddingHorizontal: space.lg, paddingBottom: space.lg, width: '100%', maxWidth: 560, alignSelf: 'center' },
  section: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.textMuted, paddingTop: space.md, paddingBottom: space.xs },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderRadius: radius.md },
  pressed: { opacity: 0.7 },
  personText: { flex: 1, gap: 1 },
  name: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  detail: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
  empty: { fontFamily: fonts.body, fontSize: 15, color: t.textMuted, paddingVertical: space.lg },
  footer: { padding: space.lg, gap: space.sm, borderTopWidth: 1, borderTopColor: t.border },
  error: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 19, color: t.dangerText },
  nameStep: { padding: space.lg, gap: space.md, width: '100%', maxWidth: 560, alignSelf: 'center' },
  nameInput: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: t.surface,
    paddingHorizontal: space.md,
    fontFamily: fonts.bodySemiBold,
    fontSize: 17,
    color: t.text,
  },
}));
