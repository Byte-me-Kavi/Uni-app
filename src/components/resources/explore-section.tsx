import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';

import { SearchInput } from '@/components/resources/search-input';
import { SharedRow } from '@/components/resources/shared-row';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { useMyModules } from '@/lib/modules';
import { exploreFiles, loadExploreOverview, type ExploreOverview, type SharedFile } from '@/lib/shared';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// Explore: past papers, notes and slides students at the university shared. Search, the student's
// modules with how much each holds, their own files waiting to be checked, and the latest shares.
export function ExploreSection({ refreshKey }: { refreshKey: number }) {
  const theme = useTheme();
  const styles = useStyles();
  const { data } = useMyModules();
  const [query, setQuery] = useState('');
  const [overview, setOverview] = useState<ExploreOverview | null>(null);
  const [files, setFiles] = useState<SharedFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadExploreOverview().then((o) => live && o && setOverview(o));
    return () => {
      live = false;
    };
  }, [refreshKey]);

  // Latest shares, or search results as the student types.
  useEffect(() => {
    let live = true;
    const timer = setTimeout(
      () =>
        exploreFiles({ query }).then((r) => {
          if (!live) return;
          setFiles(r.files);
          setError(r.error);
        }),
      query ? 250 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, refreshKey]);

  const allModules = data?.batch ? [...data.current, ...data.past.flatMap((p) => p.modules)] : [];
  const moduleRows = (overview?.modules ?? [])
    .map((m) => ({ ...m, card: allModules.find((c) => c.id === m.module_id) }))
    .filter((m) => m.card);
  const searching = query.trim().length >= 2;

  return (
    <View style={styles.stack}>
      <SearchInput value={query} onChangeText={setQuery} placeholder="Search past papers and notes" />

      {!searching ? (
        <>
          <Button label="Share a file" variant="quiet" onPress={() => router.push('/share')} />

          {overview && overview.mine.length > 0 ? (
            <View style={styles.gap}>
              <Text style={styles.groupTitle}>Your files</Text>
              <View style={styles.card}>
                {overview.mine.map((f) => (
                  <SharedRow key={f.id} file={f} showModule />
                ))}
              </View>
            </View>
          ) : null}

          {moduleRows.length > 0 ? (
            <View style={styles.gap}>
              <Text style={styles.groupTitle}>Your modules</Text>
              <View style={styles.card}>
                {moduleRows.map((m) => (
                  <PressableScale
                    key={m.module_id}
                    onPress={() => router.push({ pathname: '/module/[id]', params: { id: String(m.module_id), tab: 'shared' } })}
                    accessibilityRole="button"
                    style={styles.moduleRow}>
                    <View style={styles.moduleCopy}>
                      <Text style={styles.moduleCode}>{m.card!.code}</Text>
                      <Text style={styles.moduleName} numberOfLines={1}>
                        {m.card!.name}
                      </Text>
                    </View>
                    <Text style={styles.count}>{m.count === 1 ? '1 file' : `${m.count} files`}</Text>
                    <CaretRightIcon size={16} weight="bold" color={theme.textMuted} />
                  </PressableScale>
                ))}
              </View>
            </View>
          ) : null}
        </>
      ) : null}

      <View style={styles.gap}>
        <Text style={styles.groupTitle}>{searching ? 'Results' : 'Recently shared at your university'}</Text>
        {files === null ? (
          error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} style={styles.spinner} />
        ) : files.length === 0 ? (
          <Text style={styles.muted}>
            {searching ? `Nothing shared matches “${query.trim()}”.` : 'Nothing shared yet. Be the first: share a past paper or your notes.'}
          </Text>
        ) : (
          <View style={styles.card}>
            {files.map((f) => (
              <SharedRow key={f.id} file={f} showModule onRemoved={(id) => setFiles((l) => l?.filter((x) => x.id !== id) ?? l)} />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  stack: { gap: space.xl },
  gap: { gap: space.sm },
  spinner: { paddingVertical: space.xl },
  groupTitle: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted, paddingHorizontal: space.xs },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, paddingLeft: space.md, paddingRight: space.xs, paddingVertical: space.xs },
  moduleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingRight: space.sm },
  moduleCopy: { flex: 1, gap: 1 },
  moduleCode: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.accentText },
  moduleName: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: t.text },
  count: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: t.textMuted },
  muted: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted, paddingHorizontal: space.xs },
}));
