import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { KuppiCard } from '@/components/resources/kuppi-card';
import { KuppiRequests } from '@/components/resources/kuppi-requests';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { listKuppi, type Kuppi } from '@/lib/kuppi';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Lists = { mine: Kuppi[]; modules: Kuppi[]; others: Kuppi[] };

async function loadAll(): Promise<{ lists: Lists | null; error: string | null }> {
  const [mine, modules, all] = await Promise.all([listKuppi('mine'), listKuppi('my_modules'), listKuppi('all')]);
  const error = mine.error ?? modules.error ?? all.error;
  if (!mine.list || !modules.list || !all.list) return { lists: null, error };
  const seen = new Set(mine.list.map((k) => k.id));
  const forModules = modules.list.filter((k) => !seen.has(k.id));
  forModules.forEach((k) => seen.add(k.id));
  return { lists: { mine: mine.list, modules: forModules, others: all.list.filter((k) => !seen.has(k.id)) }, error: null };
}

// The Kuppi part of Resources: what the student is going to or hosting, kuppi for their modules,
// then the rest at their university.
export function KuppiSection({ refreshKey }: { refreshKey: number }) {
  const theme = useTheme();
  const styles = useStyles();
  const [lists, setLists] = useState<Lists | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((r: { lists: Lists | null; error: string | null }) => {
    if (r.lists) setLists(r.lists);
    setError(r.error);
  }, []);

  useEffect(() => {
    let live = true;
    loadAll().then((r) => live && apply(r));
    return () => {
      live = false;
    };
  }, [apply, refreshKey]);

  const section = (title: string, list: Kuppi[]) =>
    list.length > 0 ? (
      <View style={styles.gap} key={title}>
        <Text style={styles.groupTitle} accessibilityRole="header">
          {title}
        </Text>
        {list.map((k) => (
          <KuppiCard key={k.id} kuppi={k} />
        ))}
      </View>
    ) : null;

  return (
    <View style={styles.stack}>
      <Button label="Host a kuppi" onPress={() => router.push('/kuppi/new')} />
      <KuppiRequests scope="my_modules" refreshKey={refreshKey} />
      {lists === null ? (
        error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} style={styles.spinner} />
      ) : lists.mine.length + lists.modules.length + lists.others.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No kuppi coming up</Text>
          <Text style={styles.muted}>
            Peer tutoring on Zoom, Meet or Teams, or in person. Host one on a topic you know well: batchmates RSVP and
            get the link 15 minutes before it starts.
          </Text>
        </View>
      ) : (
        <>
          {section('Going and hosting', lists.mine)}
          {section('For your modules', lists.modules)}
          {section('More at your university', lists.others)}
        </>
      )}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  stack: { gap: space.xl },
  gap: { gap: space.md },
  spinner: { paddingVertical: space.xl },
  groupTitle: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted, paddingHorizontal: space.xs },
  empty: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.xl, gap: space.sm },
  emptyTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  muted: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted },
}));
