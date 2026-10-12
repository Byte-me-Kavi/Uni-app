import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';

import { useItemControls } from '@/components/resources/item-controls';
import { ItemRow } from '@/components/resources/item-row';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { loadToSort, organiseItem, type LibraryItem } from '@/lib/library';
import { useMyModules } from '@/lib/modules';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// To sort: files and links from the last 60 days that matched none of the student's modules. One
// tap on a module files it; the likeliest module is marked.
export default function ToSort() {
  const theme = useTheme();
  const styles = useStyles();
  const { data: modules } = useMyModules();
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filing, setFiling] = useState<string | null>(null);

  const apply = useCallback(({ items: next, error: e }: Awaited<ReturnType<typeof loadToSort>>) => {
    if (next) setItems(next);
    setError(e);
  }, []);
  const load = useCallback(() => loadToSort().then(apply), [apply]);

  useEffect(() => {
    let live = true;
    loadToSort().then((result) => live && apply(result));
    return () => {
      live = false;
    };
  }, [apply]);

  const controls = useItemControls(load);
  const current = modules?.batch ? modules.current : [];

  async function file(item: LibraryItem, moduleId: number) {
    setFiling(item.id);
    setError(null);
    const e = await organiseItem(item.id, { moduleId });
    setFiling(null);
    if (e) setError(e);
    else setItems((list) => list?.filter((x) => x.id !== item.id) ?? list);
  }

  return (
    <Screen style={styles.screen}>
      <BackHeader title="To sort" />
      {items === null ? (
        <View style={styles.center}>
          {error ? (
            <View style={styles.gap}>
              <FormMessage message={error} />
              <Button label="Try again" variant="quiet" onPress={load} />
            </View>
          ) : (
            <ActivityIndicator color={theme.accentText} />
          )}
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.content}
          ListHeaderComponent={
            <View style={styles.gap}>
              <Text style={styles.lead}>
                Files and links from your chats that did not mention one of your modules. Tap a module to file one.
              </Text>
              <FormMessage message={error} />
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>All sorted</Text>
              <Text style={styles.lead}>New files that need a module will wait here.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <ItemRow item={item} onOpen={controls.open} onMore={controls.more} note={controls.notes[item.id]} />
              <View style={styles.chips}>
                {current.map((m) => {
                  const suggested = m.id === item.suggested_module_id;
                  return (
                    <PressableScale
                      key={m.id}
                      onPress={() => file(item, m.id)}
                      disabled={filing !== null}
                      accessibilityRole="button"
                      accessibilityLabel={`File in ${m.code}, ${m.name}${suggested ? ', suggested' : ''}`}
                      style={[styles.chip, suggested && styles.chipSuggested]}>
                      <Text style={[styles.chipText, suggested && styles.chipTextSuggested]}>{m.code}</Text>
                    </PressableScale>
                  );
                })}
                {filing === item.id ? <ActivityIndicator color={theme.accentText} /> : null}
              </View>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
      {controls.elements}
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  content: { padding: space.xl, paddingBottom: space.xxxl, gap: space.md, width: '100%', maxWidth: 600, alignSelf: 'center' },
  gap: { gap: space.md, marginBottom: space.md },
  lead: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: t.textMuted },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, paddingLeft: space.md, paddingRight: space.xs, paddingBottom: space.md },
  separator: { height: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center', paddingRight: space.md },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: t.border,
    backgroundColor: t.background,
  },
  // The suggested module: filled accent, Ink text (brand rule).
  chipSuggested: { backgroundColor: brand.accent, borderColor: brand.accent },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  chipTextSuggested: { color: brand.ink },
  empty: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.xl, gap: space.sm },
  emptyTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
}));
