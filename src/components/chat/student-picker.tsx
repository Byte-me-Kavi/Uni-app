import { useState } from 'react';
import { ActivityIndicator, FlatList, Text, TextInput, View } from 'react-native';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';

import { ModalScreen } from '@/components/chat/modal-screen';
import { Avatar } from '@/components/ui/avatar';
import { PressableScale } from '@/components/ui/pressable-scale';
import { usePeopleSearch, type PersonResult } from '@/lib/use-people-search';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// Choosing a student to share in a chat: the same fast name search as the top bar. Only students
// who can be found are listed, so sharing never reveals someone who chose to stay hidden.
export function StudentPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (person: PersonResult) => void }) {
  const theme = useTheme();
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const search = usePeopleSearch(query);
  const results = search.results.filter((p) => !p.blocked);

  function close() {
    setQuery('');
    onClose();
  }

  return (
    <ModalScreen visible={visible} title="Share a student" onClose={close}>
      <View style={styles.field}>
        <MagnifyingGlassIcon size={20} color={theme.textMuted} weight="bold" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name"
          placeholderTextColor={theme.textMuted}
          autoFocus
          autoCorrect={false}
          style={styles.input}
          selectionColor={theme.accent}
          cursorColor={theme.accent}
          accessibilityLabel="Search students by name"
        />
        {search.status === 'loading' ? <ActivityIndicator color={theme.textMuted} /> : null}
      </View>
      <FlatList
        data={results}
        keyExtractor={(p) => p.user_id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <PressableScale
            onPress={() => {
              setQuery('');
              onPick(item);
            }}
            scale={0.985}
            accessibilityRole="button"
            accessibilityLabel={`Share ${item.full_name}, ${item.institution}`}
            style={styles.row}>
            <Avatar name={item.full_name} path={item.avatar_path} size={44} />
            <View style={styles.text}>
              <Text style={styles.name} numberOfLines={1}>
                {item.full_name}
              </Text>
              <Text style={styles.detail} numberOfLines={1}>
                {[item.institution, item.programme].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </PressableScale>
        )}
        ListEmptyComponent={
          <Text style={styles.note}>
            {search.status === 'error'
              ? search.message
              : query.trim().length < 2
                ? 'Type at least two letters of their name.'
                : search.status === 'ready'
                  ? 'No students found.'
                  : ' '}
          </Text>
        }
      />
    </ModalScreen>
  );
}

const useStyles = createThemedStyles((t) => ({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    margin: space.lg,
    paddingHorizontal: space.lg,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: t.surface,
  },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: t.text, height: 48 },
  list: { paddingHorizontal: space.md, paddingBottom: space.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.md },
  text: { flex: 1, gap: 1 },
  name: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  detail: { fontFamily: fonts.body, fontSize: 14, color: t.textMuted },
  note: { fontFamily: fonts.body, fontSize: 15, color: t.textMuted, textAlign: 'center', padding: space.xl },
}));
