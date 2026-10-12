import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ThumbsUpIcon } from 'phosphor-react-native/src/icons/ThumbsUp';

import { ModuleDot } from '@/components/resources/module-dot';
import { ModuleChip } from '@/components/resources/module-chip';
import { ReportSheet, type ReportTarget } from '@/components/chat/report-sheet';
import { ActionSheet, type SheetAction } from '@/components/ui/action-sheet';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { TextField } from '@/components/ui/text-field';
import { weekdayDayMonth } from '@/lib/dates';
import { closeRequest, listRequests, requestKuppi, voteRequest, type KuppiRequest } from '@/lib/kuppi';
import { useMyModules } from '@/lib/modules';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// "You asked · Wanted at 3 universities"
const footnote = (r: KuppiRequest) =>
  [r.mine ? 'You asked' : null, r.universities && r.universities > 1 ? `Wanted at ${r.universities} universities` : null]
    .filter(Boolean)
    .join(' · ');

type Props = { scope: 'my_modules' | 'module'; moduleId?: number; refreshKey?: number };

// "Students are asking for": kuppi requests, most wanted first, with a vote each and "Host this".
// Who asked is never shown. Asking a similar question adds a vote instead of a duplicate. Requests
// asked of all universities come from students on the same subject elsewhere, with their university.
export function KuppiRequests({ scope, moduleId, refreshKey = 0 }: Props) {
  const theme = useTheme();
  const styles = useStyles();
  const [list, setList] = useState<KuppiRequest[] | null>(null);
  const [menu, setMenu] = useState<KuppiRequest | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    listRequests(scope, moduleId).then((r) => live && r.list && setList(r.list));
    return () => {
      live = false;
    };
  }, [scope, moduleId, refreshKey, version]);

  async function vote(r: KuppiRequest) {
    const { request, error } = await voteRequest(r.id, !r.voted);
    if (error) return setNote(error);
    if (request) setList((l) => l?.map((x) => (x.id === r.id ? request : x)) ?? l);
  }

  // Answering another university's request is an online kuppi open to all universities.
  const host = (r: KuppiRequest) =>
    r.host_module_id &&
    router.push({
      pathname: '/kuppi/new',
      params: { module: String(r.host_module_id), request: r.id, title: r.topic, ...(r.other ? { national: '1' } : {}) },
    });

  const actions: SheetAction[] = menu
    ? [
        ...(!menu.closed && menu.host_module_id ? [{ label: 'Host a kuppi for this', onPress: () => host(menu) }] : []),
        ...(menu.mine && !menu.closed
          ? [
              {
                label: 'Close my request',
                onPress: async () => {
                  const e = await closeRequest(menu.id);
                  if (e) setNote(e);
                  else setVersion((v) => v + 1);
                },
              },
            ]
          : []),
        ...(!menu.mine
          ? [{ label: 'Report', destructive: true, onPress: () => setReporting({ kind: 'kuppi_request', id: menu.id, who: null, userId: null }) }]
          : []),
      ]
    : [];

  return (
    <View style={styles.gap}>
      <Text style={styles.title} accessibilityRole="header">
        Students are asking for
      </Text>
      <FormMessage message={note} tone="info" />
      {list && list.length > 0 ? (
        <View style={styles.card}>
          {list.map((r) => (
            <View key={r.id} style={styles.row}>
              <PressableScale
                onPress={() => (r.session ? router.push({ pathname: '/kuppi/[id]', params: { id: r.session.id } }) : setMenu(r))}
                onLongPress={() => setMenu(r)}
                accessibilityRole="button"
                style={styles.rowMain}>
                {r.other ? (
                  <Text style={styles.code} numberOfLines={1}>
                    Asked at {r.institution ?? 'another university'} · {r.module.name}
                  </Text>
                ) : scope !== 'module' ? (
                  <View style={styles.moduleLine}>
                    <ModuleDot id={r.module.id} size={8} />
                    <Text style={[styles.code, styles.shrink]} numberOfLines={1}>
                      {r.module.code} · {r.module.name}
                    </Text>
                  </View>
                ) : null}
                <Text style={styles.topic}>{r.topic}</Text>
                {r.session ? (
                  <Text style={styles.answered}>
                    Kuppi on {weekdayDayMonth(r.session.starts_at)} ›
                  </Text>
                ) : r.answered ? (
                  <Text style={styles.meta}>Answered with a kuppi at {r.institution ?? 'their university'}</Text>
                ) : r.details ? (
                  <Text style={styles.meta} numberOfLines={2}>
                    {r.details}
                  </Text>
                ) : null}
                {footnote(r) ? <Text style={styles.meta}>{footnote(r)}</Text> : null}
              </PressableScale>
              {!r.closed ? (
                <PressableScale
                  onPress={() => vote(r)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: r.voted }}
                  accessibilityLabel={`${r.votes} want this. ${r.voted ? 'Take back your vote' : 'I want this too'}`}
                  style={[styles.vote, r.voted && styles.voteOn]}>
                  <ThumbsUpIcon size={16} weight={r.voted ? 'fill' : 'bold'} color={r.voted ? theme.onAccent : theme.text} />
                  <Text style={[styles.voteText, r.voted && styles.voteTextOn]}>{r.votes}</Text>
                </PressableScale>
              ) : null}
            </View>
          ))}
        </View>
      ) : list ? (
        <Text style={styles.muted}>Nobody has asked for a kuppi yet. Stuck on a topic? Ask: others add their vote and hosts see what is wanted.</Text>
      ) : null}

      <ActionSheet visible={!!menu} title={menu?.topic} actions={actions} onClose={() => setMenu(null)} />
      <ReportSheet target={reporting} onClose={() => setReporting(null)} />
    </View>
  );
}

// "Host a kuppi" and "Ask for a kuppi", side by side and equally easy to find. onAsked: a request was
// sent (refresh the list).
export function KuppiActions({ moduleId, onAsked }: { moduleId?: number; onAsked: () => void }) {
  const styles = useStyles();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <View style={styles.gap}>
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button
            label="Host a kuppi"
            onPress={() => router.push({ pathname: '/kuppi/new', params: moduleId ? { module: String(moduleId) } : {} })}
          />
        </View>
        <View style={styles.action}>
          <Button
            label="Ask for a kuppi"
            onPress={() => {
              setNote(null);
              setAsking(true);
            }}
          />
        </View>
      </View>
      <FormMessage message={note} tone="info" />
      <AskSheet
        visible={asking}
        moduleId={moduleId}
        onClose={() => setAsking(false)}
        onDone={(r) => {
          setAsking(false);
          setNote(
            r.merged
              ? 'Someone asked something similar: your vote went to it.'
              : r.scope === 'national'
                ? 'Asked. Students on this subject at every university can add their vote.'
                : 'Asked. Batchmates can add their vote.',
          );
          onAsked();
        }}
      />
    </View>
  );
}

function AskSheet({ visible, moduleId, onClose, onDone }: { visible: boolean; moduleId?: number; onClose: () => void; onDone: (r: KuppiRequest) => void }) {
  return (
    <BottomSheet visible={visible} title="Ask for a kuppi" onClose={onClose} height={0.8}>
      {visible ? <AskForm moduleId={moduleId} onDone={onDone} /> : null}
    </BottomSheet>
  );
}

function AskForm({ moduleId, onDone }: { moduleId?: number; onDone: (r: KuppiRequest) => void }) {
  const theme = useTheme();
  const styles = useStyles();
  const { data } = useMyModules();
  const modules = data?.batch ? data.current.filter((m) => !m.pending) : [];
  const [module, setModule] = useState<number | null>(moduleId ?? null);
  const [topic, setTopic] = useState('');
  const [details, setDetails] = useState('');
  const [reach, setReach] = useState<'national' | 'university'>('national');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!module) return setError('Choose the module.');
    setBusy(true);
    setError(null);
    const { request, error: e } = await requestKuppi(module, topic.trim(), details, reach);
    setBusy(false);
    if (e || !request) return setError(e);
    onDone(request);
  }

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <Text style={[styles.muted, { color: theme.textMuted }]}>Nobody sees who asked, only how many want it.</Text>
      {!moduleId ? (
        <View style={styles.chips}>
          {modules.map((m) => (
            <ModuleChip key={m.id} id={m.id} code={m.code} name={m.name} active={m.id === module} onPress={() => setModule(m.id)} />
          ))}
        </View>
      ) : null}
      <TextField label="What do you need help with?" value={topic} onChangeText={setTopic} placeholder="e.g. AVL tree rotations" maxLength={120} />
      <TextField label="More detail (optional)" value={details} onChangeText={setDetails} placeholder="e.g. Q4 of the 2023 paper" multiline maxLength={500} />
      <View style={styles.gap}>
        <Text style={styles.label}>Who can see it</Text>
        <View style={styles.chips}>
          {(
            [
              ['national', 'All universities'],
              ['university', 'My university'],
            ] as const
          ).map(([key, label]) => (
            <PressableScale
              key={key}
              onPress={() => setReach(key)}
              accessibilityRole="radio"
              accessibilityState={{ selected: reach === key }}
              style={[styles.chip, reach === key && styles.chipActive]}>
              <Text style={[styles.chipText, reach === key && styles.chipTextActive]}>{label}</Text>
            </PressableScale>
          ))}
        </View>
        <Text style={styles.muted}>
          {reach === 'national'
            ? 'Students taking this subject at any university can vote and host an online kuppi. They see your university, not your name.'
            : 'Only students at your university see it.'}
        </Text>
      </View>
      <FormMessage message={error} />
      <Button label="Ask" loading={busy} onPress={send} />
    </ScrollView>
  );
}

const useStyles = createThemedStyles((t) => ({
  gap: { gap: space.sm },
  // Side by side when both labels fit, else one under the other (never cut off).
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  action: { flexGrow: 1, flexBasis: 200 },
  title: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted, paddingHorizontal: space.xs },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, minHeight: 56 },
  rowMain: { flex: 1, gap: 2 },
  moduleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shrink: { flexShrink: 1 },
  code: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.accentText },
  topic: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 20, color: t.text },
  meta: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  answered: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.accentText },
  muted: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.textMuted, paddingHorizontal: space.xs },
  vote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 56,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: t.border,
  },
  // Voted: the accent with Ink (brand rule).
  voteOn: { backgroundColor: t.accent, borderColor: t.accent },
  voteText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  voteTextOn: { color: t.onAccent },
  form: { paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { paddingHorizontal: space.md + 2, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: 1.5, borderColor: t.border, backgroundColor: t.surface },
  chipActive: { backgroundColor: t.accent, borderColor: t.accent },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  chipTextActive: { color: t.onAccent },
}));
