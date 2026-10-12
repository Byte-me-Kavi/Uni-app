import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';

import { useItemControls } from '@/components/resources/item-controls';
import { ItemRow } from '@/components/resources/item-row';
import { KuppiCard } from '@/components/resources/kuppi-card';
import { ModuleDot } from '@/components/resources/module-dot';
import { SharedRow } from '@/components/resources/shared-row';
import { PressableScale } from '@/components/ui/pressable-scale';
import { searchKuppi, type Kuppi, type KuppiRequest } from '@/lib/kuppi';
import { searchLibrary, type LibraryItem } from '@/lib/library';
import { useModulesSnapshot, type ModuleCard, type MyModules } from '@/lib/modules';
import { exploreFiles, type SharedFile } from '@/lib/shared';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// How many of each kind show before "Show all".
const FIRST = 5;

type Results = {
  files: LibraryItem[] | null;
  shared: SharedFile[] | null;
  kuppi: Kuppi[] | null;
  requests: KuppiRequest[] | null;
  failed: boolean;
};

// One search for all of Resources: the student's modules (by name or code), their own files (names
// and the text inside), files shared at their university, and kuppi and kuppi requests. Grouped by
// kind, the closest first.
export function ResourcesSearch({ query }: { query: string }) {
  const theme = useTheme();
  const styles = useStyles();
  const q = query.trim();
  const data = useModulesSnapshot();
  const [results, setResults] = useState<{ q: string; r: Results } | null>(null);
  const [version, setVersion] = useState(0);
  const controls = useItemControls(() => setVersion((v) => v + 1));

  // Modules match on the phone, as the student types.
  const modules = matchModules(data, q);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      const [files, shared, kuppi] = await Promise.all([searchLibrary(q), exploreFiles({ query: q }), searchKuppi(q)]);
      if (!live) return;
      setResults({
        q,
        r: {
          files: files.items,
          shared: shared.files,
          kuppi: kuppi.sessions,
          requests: kuppi.requests,
          failed: !!(files.error && shared.error && kuppi.error),
        },
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, version]);

  const r = results?.r ?? null;
  const loading = results?.q !== q;
  const nothing =
    !loading && r && modules.length === 0 && !r.files?.length && !r.shared?.length && !r.kuppi?.length && !r.requests?.length;

  return (
    <View style={styles.stack}>
      {modules.length > 0 ? (
        <Group title="Modules" count={modules.length}>
          {(show) => (
            <View style={styles.card}>
              {modules.slice(0, show).map((m) => (
                <PressableScale
                  key={m.id}
                  onPress={() => router.push({ pathname: '/module/[id]', params: { id: String(m.id) } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${m.name}, ${m.code}`}
                  style={styles.moduleRow}>
                  <ModuleDot id={m.id} />
                  <View style={styles.flex}>
                    <Text style={styles.moduleName} numberOfLines={1}>
                      {m.name}
                    </Text>
                    <Text style={styles.meta}>{m.code}</Text>
                  </View>
                  <CaretRightIcon size={16} weight="bold" color={theme.textMuted} />
                </PressableScale>
              ))}
            </View>
          )}
        </Group>
      ) : null}

      {loading && !r ? <ActivityIndicator color={theme.accentText} style={styles.spinner} /> : null}

      {r?.files?.length ? (
        <Group title="Your files" count={r.files.length}>
          {(show) => (
            <View style={styles.card}>
              {r.files!.slice(0, show).map((item) => (
                <ItemRow key={item.id} item={item} onOpen={controls.open} onMore={controls.more} note={controls.notes[item.id]} />
              ))}
            </View>
          )}
        </Group>
      ) : null}

      {r?.shared?.length ? (
        <Group title="Shared at your university" count={r.shared.length}>
          {(show) => (
            <View style={styles.card}>
              {r.shared!.slice(0, show).map((f) => (
                <SharedRow key={f.id} file={f} showModule />
              ))}
            </View>
          )}
        </Group>
      ) : null}

      {r?.kuppi?.length ? (
        <Group title="Kuppi" count={r.kuppi.length}>
          {(show) => (
            <View style={styles.gap}>
              {r.kuppi!.slice(0, show).map((k) => (
                <KuppiCard key={k.id} kuppi={k} />
              ))}
            </View>
          )}
        </Group>
      ) : null}

      {r?.requests?.length ? (
        <Group title="Students are asking for" count={r.requests.length}>
          {(show) => (
            <View style={styles.card}>
              {r.requests!.slice(0, show).map((req) => {
                const target = req.other ? req.host_module_id : req.module.id;
                return (
                  <PressableScale
                    key={req.id}
                    disabled={!target}
                    onPress={() => target && router.push({ pathname: '/module/[id]', params: { id: String(target), tab: 'kuppi' } })}
                    accessibilityRole="button"
                    style={styles.moduleRow}>
                    <ModuleDot id={target ?? req.module.id} />
                    <View style={styles.flex}>
                      <Text style={styles.moduleName} numberOfLines={2}>
                        {req.topic}
                      </Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {req.other ? `${req.institution ?? 'Another university'} · ` : ''}
                        {req.module.name} · {req.votes === 1 ? '1 wants this' : `${req.votes} want this`}
                      </Text>
                    </View>
                    {target ? <CaretRightIcon size={16} weight="bold" color={theme.textMuted} /> : null}
                  </PressableScale>
                );
              })}
            </View>
          )}
        </Group>
      ) : null}

      {r?.failed ? <Text style={styles.muted}>Could not search. Check your connection and try again.</Text> : null}
      {nothing && !r?.failed ? <Text style={styles.muted}>Nothing in Resources matches “{q}”.</Text> : null}
      {loading && r ? <ActivityIndicator color={theme.accentText} /> : null}
      {controls.elements}
    </View>
  );
}

function matchModules(data: MyModules | null, q: string) {
  if (!data?.batch) return [];
  const text = q.toLowerCase();
  const code = text.replace(/\s+/g, '');
  const all = new Map<number, ModuleCard>();
  for (const m of [...data.current, ...data.electives, ...data.past.flatMap((p) => p.modules)]) all.set(m.id, m);
  return [...all.values()].filter((m) => m.name.toLowerCase().includes(text) || m.code.toLowerCase().replace(/\s+/g, '').includes(code));
}

function Group({ title, count, children }: { title: string; count: number; children: (show: number) => ReactNode }) {
  const styles = useStyles();
  const [all, setAll] = useState(false);
  return (
    <View style={styles.gap}>
      <Text style={styles.groupTitle} accessibilityRole="header">
        {title} ({count})
      </Text>
      {children(all ? count : FIRST)}
      {count > FIRST && !all ? (
        <PressableScale onPress={() => setAll(true)} accessibilityRole="button" hitSlop={8} style={styles.more}>
          <Text style={styles.link}>Show all {count}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  stack: { gap: space.xl },
  gap: { gap: space.sm },
  flex: { flex: 1, gap: 1 },
  spinner: { paddingVertical: space.xl },
  groupTitle: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted, paddingHorizontal: space.xs },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, paddingLeft: space.md, paddingRight: space.xs, paddingVertical: space.xs },
  moduleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: space.xs, paddingRight: space.sm },
  moduleName: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 20, color: t.text },
  meta: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  muted: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted, paddingHorizontal: space.xs },
  more: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', paddingHorizontal: space.xs },
  link: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.accentText },
}));
