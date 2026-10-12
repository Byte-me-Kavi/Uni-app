import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { LockSimpleIcon } from 'phosphor-react-native/src/icons/LockSimple';

import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { KeyboardFrame, KeyboardScroll } from '@/components/ui/keyboard';
import {
  findModules,
  loadSemesterPlan,
  looksLikeCode,
  saveSemester,
  termLabel,
  type ModuleMatch,
  type SaveItem,
  type SemesterPlan,
} from '@/lib/modules';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Kind = 'core' | 'elective';
/** A module on this screen: an existing one (id) or a new code the student is adding. */
type Item = { key: string; id: number | null; code: string; name: string; kind: Kind; note?: string };

const codeKey = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

// One semester of the batch: its list, modules batchmates have added, suggestions from other
// batches of the programme, and search to add any module by code. Reps save the list as it is;
// everyone else adds modules, which join the batch's list once enough batchmates add them.
export default function Semester() {
  const styles = useStyles();
  const theme = useTheme();
  const params = useLocalSearchParams<{ year: string; semester: string }>();
  const year = Number(params.year) || 1;
  const semester = Number(params.semester) || 1;

  const [plan, setPlan] = useState<SemesterPlan | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Map<string, Item>>(new Map());
  const [extra, setExtra] = useState<Item[]>([]); // added from search on this screen
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<ModuleMatch[]>([]);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    loadSemesterPlan(year, semester).then(({ plan: p, error: e }) => {
      if (!current) return;
      if (!p) {
        setLoadError(e);
        return;
      }
      setPlan(p);
      const start = new Map<string, Item>();
      for (const m of p.modules)
        start.set(String(m.id), { key: String(m.id), id: m.id, code: m.code, name: m.name, kind: m.kind });
      for (const m of p.proposals)
        if (m.mine) start.set(String(m.id), { key: String(m.id), id: m.id, code: m.code, name: m.name, kind: m.kind });
      setChosen(start);
    });
    return () => {
      current = false;
    };
  }, [year, semester]);

  // Matching modules at the university as the student types; stale answers are dropped.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let current = true;
    const timer = setTimeout(async () => {
      const found = await findModules(q);
      if (current) setMatches(found);
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);

  const listed = useMemo(() => {
    const keys = new Set<string>();
    if (plan) for (const m of [...plan.modules, ...plan.proposals, ...plan.suggestions]) keys.add(codeKey(m.code));
    for (const m of extra) keys.add(codeKey(m.code));
    return keys;
  }, [plan, extra]);

  if (!plan) {
    return (
      <Screen style={styles.screen}>
        <BackHeader title={termLabel({ year, semester })} />
        <View style={styles.center}>
          {loadError ? <FormMessage message={loadError} /> : <ActivityIndicator color={theme.accentText} />}
        </View>
      </Screen>
    );
  }

  const edit = plan.can_edit;
  const toggle = (item: Item) =>
    setChosen((current) => {
      const next = new Map(current);
      if (next.has(item.key)) next.delete(item.key);
      else next.set(item.key, item);
      return next;
    });
  const setKind = (key: string, kind: Kind) =>
    setChosen((current) => {
      const item = current.get(key);
      if (!item) return current;
      const next = new Map(current);
      next.set(key, { ...item, kind });
      return next;
    });

  function addMatch(m: ModuleMatch) {
    const item: Item = { key: String(m.id), id: m.id, code: m.code, name: m.name, kind: 'core' };
    if (!listed.has(codeKey(m.code))) setExtra((e) => [...e, item]);
    setChosen((current) => new Map(current).set(item.key, current.get(item.key) ?? item));
    setQuery('');
  }

  function addNew() {
    const code = query.trim().toUpperCase().replace(/\s+/g, ' ');
    const name = newName.trim();
    if (name.length < 2) {
      setError(`Add the module name for ${code}.`);
      return;
    }
    const item: Item = { key: `new:${codeKey(code)}`, id: null, code, name, kind: 'core', note: 'New module' };
    setExtra((e) => [...e, item]);
    setChosen((current) => new Map(current).set(item.key, item));
    setQuery('');
    setNewName('');
    setError(null);
  }

  function addAllSuggestions() {
    setChosen((current) => {
      const next = new Map(current);
      for (const m of plan!.suggestions)
        if (!next.has(String(m.id)))
          next.set(String(m.id), { key: String(m.id), id: m.id, code: m.code, name: m.name, kind: m.kind });
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    const items: SaveItem[] = [...chosen.values()].map((i) =>
      i.id !== null ? { module_id: i.id, kind: i.kind } : { code: i.code, name: i.name, kind: i.kind },
    );
    const { error: e } = await saveSemester(year, semester, items);
    setSaving(false);
    if (e) setError(e);
    else router.back();
  }

  const q = query.trim();
  const shown = q.length < 2 ? [] : matches;
  const exact = shown.some((m) => codeKey(m.code) === codeKey(q));
  const offerNew = looksLikeCode(q) && !exact && !listed.has(codeKey(q));
  const others = plan.proposals.filter((p) => !p.mine);

  return (
    <Screen style={styles.screen}>
      <BackHeader title={termLabel({ year, semester })} />
      <KeyboardFrame style={styles.flex}>
        <KeyboardScroll contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.stack}>
            <Text style={styles.lead}>
              {edit
                ? 'You are a batch rep: this list is what your whole batch sees for this semester.'
                : plan.votes_needed > 1
                  ? `Modules you add show for you straight away, and join your batch’s list when ${plan.votes_needed} batchmates add them.`
                  : 'Modules you add go on your batch’s list.'}
            </Text>

            {plan.modules.length > 0 ? (
              <Group title="Your batch's list">
                {plan.modules.map((m) => {
                  const item: Item = { key: String(m.id), id: m.id, code: m.code, name: m.name, kind: m.kind };
                  return edit ? (
                    <Row
                      key={m.id}
                      item={chosen.get(item.key) ?? item}
                      on={chosen.has(item.key)}
                      onToggle={() => toggle(item)}
                      onKind={setKind}
                    />
                  ) : (
                    <Row key={m.id} item={item} on locked />
                  );
                })}
              </Group>
            ) : null}

            {others.length > 0 ? (
              <Group title="Added by batchmates">
                {others.map((m) => {
                  const item: Item = {
                    key: String(m.id),
                    id: m.id,
                    code: m.code,
                    name: m.name,
                    kind: m.kind,
                    note: `${m.votes} of ${plan.votes_needed}`,
                  };
                  return (
                    <Row
                      key={m.id}
                      item={chosen.get(item.key) ?? item}
                      on={chosen.has(item.key)}
                      onToggle={() => toggle(item)}
                      onKind={setKind}
                    />
                  );
                })}
              </Group>
            ) : null}

            {plan.suggestions.length > 0 ? (
              <Group
                title={`Suggested from the ${plan.suggestions[0].from}`}
                action={{ label: 'Add all', onPress: addAllSuggestions }}>
                {plan.suggestions.map((m) => {
                  const item: Item = { key: String(m.id), id: m.id, code: m.code, name: m.name, kind: m.kind };
                  return (
                    <Row
                      key={m.id}
                      item={chosen.get(item.key) ?? item}
                      on={chosen.has(item.key)}
                      onToggle={() => toggle(item)}
                      onKind={setKind}
                    />
                  );
                })}
              </Group>
            ) : null}

            {extra.length > 0 ? (
              <Group title="Added now">
                {extra.map((item) => (
                  <Row
                    key={item.key}
                    item={chosen.get(item.key) ?? item}
                    on={chosen.has(item.key)}
                    onToggle={() => toggle(item)}
                    onKind={setKind}
                  />
                ))}
              </Group>
            ) : null}

            <View style={styles.search}>
              <TextField
                label="Add a module"
                value={query}
                onChangeText={(t) => {
                  setQuery(t);
                  setError(null);
                }}
                placeholder="Code or name, e.g. CS2012"
                autoCapitalize="characters"
                autoCorrect={false}
                hint="Type the code from your handbook or timetable. A code already used at your university is the same module."
              />
              {shown.length > 0 ? (
                <View style={styles.matches}>
                  {shown.map((m) => (
                    <PressableScale
                      key={m.id}
                      scale={0.985}
                      onPress={() => addMatch(m)}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${m.code}, ${m.name}`}
                      style={styles.match}>
                      <Text style={styles.matchCode}>{m.code}</Text>
                      <Text style={styles.matchName} numberOfLines={2}>
                        {m.name}
                      </Text>
                      {m.batches > 0 ? (
                        <Text style={styles.matchMeta}>{m.batches === 1 ? '1 batch' : `${m.batches} batches`}</Text>
                      ) : null}
                    </PressableScale>
                  ))}
                </View>
              ) : null}
              {offerNew ? (
                <View style={styles.newBox}>
                  <Text style={styles.newTitle}>{q.toUpperCase()} is new at your university</Text>
                  <TextField
                    label="Module name"
                    value={newName}
                    onChangeText={setNewName}
                    placeholder="e.g. Data Structures and Algorithms"
                    autoCapitalize="words"
                  />
                  <Button label={`Add ${q.toUpperCase()}`} variant="quiet" onPress={addNew} />
                </View>
              ) : null}
            </View>
          </View>
        </KeyboardScroll>
        <View style={styles.footer}>
          <FormMessage message={error} />
          <Button label={edit ? 'Save list' : 'Save'} loading={saving} onPress={save} />
        </View>
      </KeyboardFrame>
    </Screen>
  );
}

function Group({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.group}>
      <View style={styles.groupHead}>
        <Text style={styles.groupTitle} accessibilityRole="header">
          {title}
        </Text>
        {action ? (
          <PressableScale onPress={action.onPress} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.link}>{action.label}</Text>
          </PressableScale>
        ) : null}
      </View>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

type RowProps = {
  item: Item;
  on: boolean;
  locked?: boolean;
  onToggle?: () => void;
  onKind?: (key: string, kind: Kind) => void;
};

// A module with a tick, and Core / Elective once ticked.
function Row({ item, on, locked = false, onToggle, onKind }: RowProps) {
  const styles = useStyles();
  const theme = useTheme();
  const detail = [item.kind === 'elective' ? 'Elective' : null, item.note].filter(Boolean).join(' · ');
  return (
    <View style={styles.row}>
      <PressableScale
        onPress={onToggle}
        disabled={locked}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on, disabled: locked }}
        accessibilityLabel={`${item.code}, ${item.name}`}
        style={styles.rowMain}>
        <View style={[styles.box, on && styles.boxOn]}>
          {locked ? (
            <LockSimpleIcon size={14} weight="bold" color={theme.onAccent} />
          ) : on ? (
            <CheckIcon size={14} weight="bold" color={theme.onAccent} />
          ) : null}
        </View>
        <View style={styles.rowCopy}>
          <Text style={styles.rowCode}>{item.code}</Text>
          <Text style={styles.rowName} numberOfLines={2}>
            {item.name}
          </Text>
          {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
        </View>
      </PressableScale>
      {on && !locked && onKind ? (
        <PressableScale
          onPress={() => onKind(item.key, item.kind === 'core' ? 'elective' : 'core')}
          accessibilityRole="button"
          accessibilityLabel={`${item.code} is ${item.kind}. Change`}
          hitSlop={6}
          style={styles.kind}>
          <Text style={[styles.kindText, { color: theme.text }]}>{item.kind === 'core' ? 'Core' : 'Elective'}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  content: { padding: space.xl, paddingBottom: space.xxxl },
  stack: { gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  lead: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: t.textMuted },
  group: { gap: space.sm },
  groupHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xs },
  groupTitle: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted },
  link: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.accentText },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, minHeight: 56 },
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.sm - 1,
    borderWidth: 1.5,
    borderColor: t.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: t.accent, borderColor: t.accent },
  rowCopy: { flex: 1, gap: 1 },
  rowCode: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.accentText },
  rowName: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 20, color: t.text },
  rowDetail: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  kind: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: t.border,
    backgroundColor: t.background,
  },
  kindText: { fontFamily: fonts.bodyBold, fontSize: 13 },
  search: { gap: space.md },
  matches: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.xs },
  match: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
  },
  matchCode: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.accentText, minWidth: 72 },
  matchName: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 15, color: t.text },
  matchMeta: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.textMuted },
  newBox: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  newTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.md,
    gap: space.sm,
    borderTopWidth: 1,
    borderTopColor: t.border,
    backgroundColor: t.background,
  },
}));
