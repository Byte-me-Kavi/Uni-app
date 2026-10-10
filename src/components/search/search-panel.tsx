import { ScrollView, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { PressableScale } from '@/components/ui/pressable-scale';
import { normalise, usePeopleSearch, type PersonResult } from '@/lib/use-people-search';
import { createThemedStyles, fonts, radius, space } from '@/theme/tokens';

type Props = {
  query: string;
  onOpen: (person: PersonResult) => void;
};

// Covers the tab content while searching; the top bar (with the search box) stays put above it.
export function SearchPanel({ query, onOpen }: Props) {
  const styles = useStyles();
  const search = usePeopleSearch(query);
  const typed = normalise(query);
  const { results } = search;

  return (
    <ScrollView
      style={styles.panel}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag">
      {search.status === 'idle' ? (
        <View style={styles.note}>
          <Text style={styles.noteTitle}>Find students</Text>
          <Text style={styles.noteBody}>
            Search by name across every university. Your batchmates and people at your university come first.
          </Text>
        </View>
      ) : null}

      {search.status === 'error' ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {search.message}
        </Text>
      ) : null}

      {search.status === 'loading' && results.length === 0 ? <ResultsSkeleton /> : null}

      {search.status === 'ready' && results.length === 0 ? (
        <View style={styles.note} accessibilityLiveRegion="polite">
          <Text style={styles.noteTitle} numberOfLines={2}>
            No students found for “{query.trim()}”
          </Text>
          <Text style={styles.noteBody}>
            Check the spelling or try their surname. Some students choose not to appear in search.
          </Text>
        </View>
      ) : null}

      {search.status !== 'idle' && results.length > 0 ? (
        <View style={styles.list}>
          {results[0].corrected ? (
            <Text style={styles.corrected}>No exact matches. Showing similar names.</Text>
          ) : null}
          {results.map((person) => (
            <PersonRow key={person.user_id} person={person} typed={typed} onPress={() => onOpen(person)} />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

function describe(person: PersonResult) {
  if (person.blocked) return 'You blocked them';
  const where = person.relation === 'batchmate' ? 'Batchmate' : person.institution;
  const batch = person.programme ? `${person.programme}, ${person.intake_year}` : null;
  return batch ? `${where} · ${batch}` : where;
}

function PersonRow({ person, typed, onPress }: { person: PersonResult; typed: string; onPress: () => void }) {
  const styles = useStyles();
  const meta = describe(person);
  return (
    <PressableScale
      onPress={onPress}
      scale={0.985}
      accessibilityRole="button"
      accessibilityLabel={`${person.full_name}, ${meta}`}
      style={styles.row}>
      <Avatar name={person.full_name} path={person.avatar_path} size={46} />
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          <HighlightedName name={person.full_name} typed={typed} />
        </Text>
        <Text style={[styles.meta, person.blocked && styles.metaBlocked]} numberOfLines={1}>
          {meta}
        </Text>
      </View>
    </PressableScale>
  );
}

// The typed part of each matching word in heavier type, the way the eye checks a match.
function HighlightedName({ name, typed }: { name: string; typed: string }) {
  const styles = useStyles();
  const queryWords = typed.split(' ').filter(Boolean);
  return name.split(/(\s+)/).map((part, i) => {
    const lower = part.toLowerCase();
    const hit = queryWords.filter((q) => lower.startsWith(q)).sort((a, b) => b.length - a.length)[0];
    if (!hit) return part;
    return (
      <Text key={i}>
        <Text style={styles.match}>{part.slice(0, hit.length)}</Text>
        {part.slice(hit.length)}
      </Text>
    );
  });
}

function ResultsSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.list} accessible accessibilityLabel="Searching">
      {[0.62, 0.48, 0.56].map((width, i) => (
        <View key={i} style={styles.row}>
          <View style={styles.skeletonAvatar} />
          <View style={styles.rowText}>
            <View style={[styles.skeletonLine, { width: `${width * 100}%` }]} />
            <View style={[styles.skeletonLine, styles.skeletonMeta, { width: `${(width + 0.2) * 100}%` }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  panel: { flex: 1, backgroundColor: t.background },
  content: {
    paddingHorizontal: space.xl - space.sm,
    paddingTop: space.xs,
    paddingBottom: space.xxxl,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  note: { paddingHorizontal: space.sm, paddingTop: space.lg, gap: space.xs },
  noteTitle: { fontFamily: fonts.bodyBold, fontSize: 17, lineHeight: 23, color: t.text },
  noteBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted },
  error: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    lineHeight: 19,
    color: t.dangerText,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  corrected: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: t.textMuted,
    paddingHorizontal: space.sm,
    paddingBottom: space.xs,
  },
  list: { gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm + 2,
    borderRadius: radius.md,
  },
  rowText: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.bodySemiBold, fontSize: 16, lineHeight: 22, color: t.text },
  match: { fontFamily: fonts.display },
  meta: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
  metaBlocked: { fontFamily: fonts.bodyBold, color: t.dangerText },
  skeletonAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: t.surface },
  skeletonLine: { height: 14, borderRadius: radius.sm, backgroundColor: t.surface },
  skeletonMeta: { height: 12, marginTop: 6 },
}));
