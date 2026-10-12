import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { useItemControls } from '@/components/resources/item-controls';
import { ItemRow } from '@/components/resources/item-row';
import { FormMessage } from '@/components/ui/form-message';
import { searchLibrary, type LibraryItem } from '@/lib/library';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// Results for a search across the student's own library (names and module codes), as they type.
export function LibrarySearch({ query }: { query: string }) {
  const theme = useTheme();
  const styles = useStyles();
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const controls = useItemControls(() => setVersion((v) => v + 1));

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      searchLibrary(query).then((r) => {
        if (!live) return;
        setItems(r.items);
        setError(r.error);
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, version]);

  return (
    <View style={styles.gap}>
      {items === null ? (
        error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} style={styles.spinner} />
      ) : items.length === 0 ? (
        <Text style={styles.muted}>Nothing in your library matches “{query.trim()}”.</Text>
      ) : (
        <View style={styles.card}>
          {items.map((item) => (
            <ItemRow key={item.id} item={item} onOpen={controls.open} onMore={controls.more} note={controls.notes[item.id]} />
          ))}
        </View>
      )}
      {controls.elements}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  gap: { gap: space.md },
  spinner: { paddingVertical: space.xl },
  muted: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted, paddingHorizontal: space.xs },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, paddingLeft: space.md, paddingRight: space.xs, paddingVertical: space.xs },
}));
