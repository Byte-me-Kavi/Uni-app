import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { CaretDownIcon } from 'phosphor-react-native/src/icons/CaretDown';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { TrayIcon } from 'phosphor-react-native/src/icons/Tray';

import { ExamStrip } from '@/components/resources/exam-strip';
import { ExploreSection } from '@/components/resources/explore-section';
import { FirstWeek } from '@/components/resources/first-week';
import { KuppiSection } from '@/components/resources/kuppi-section';
import { ModuleDot } from '@/components/resources/module-dot';
import { ModuleTile } from '@/components/resources/module-tile';
import { ResourcesSearch } from '@/components/resources/resources-search';
import { SearchInput } from '@/components/resources/search-input';
import { TermSheet } from '@/components/resources/term-sheet';
import { Button } from '@/components/ui/button';
import { CheckRow } from '@/components/ui/check-row';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { daysText, EXAM_SEASON_DAYS, refreshExams, useMyExams } from '@/lib/exams';
import { refreshOverview, useLibraryOverview, type Overview } from '@/lib/library';
import { nextTerm, setModuleChoice, termLabel, useMyModules, type BatchModules, type ModuleCard } from '@/lib/modules';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Section = 'modules' | 'kuppi' | 'explore';
const SECTIONS: { key: Section; label: string }[] = [
  { key: 'modules', label: 'My modules' },
  { key: 'kuppi', label: 'Kuppi' },
  { key: 'explore', label: 'Explore' },
];

// About five months into a semester, the batch is asked whether it has ended.
const NUDGE_DAYS = 150;

// Resources: everything for studying, organised by the modules the student takes this semester.
// Content only; the top bar and tab bar live in (tabs)/_layout.tsx.
export default function Resources() {
  const theme = useTheme();
  const styles = useStyles();
  const { data, status, refresh } = useMyModules();
  const overview = useLibraryOverview();
  const [section, setSection] = useState<Section>('modules');
  const [refreshing, setRefreshing] = useState(false);
  // Kuppi and Explore reload when this changes (pull to refresh).
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState('');
  // One search for all of Resources: while it has text, its results replace the sections.
  const searching = query.trim().length >= 2;

  async function pull() {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    await Promise.all([refresh(), refreshOverview(), refreshExams()]);
    setRefreshing(false);
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={pull}
          tintColor={theme.accentText}
          colors={[theme.accentText]}
          progressBackgroundColor={theme.surface}
        />
      }>
      <View style={styles.stack}>
        <Text style={styles.title} accessibilityRole="header">
          Resources
        </Text>

        <SearchInput value={query} onChangeText={setQuery} placeholder="Search modules, files and kuppi" />

        {searching ? <ResourcesSearch query={query} /> : null}

        {!searching ? (
          <View style={styles.segments} accessibilityRole="tablist">
            {SECTIONS.map((s) => {
              const active = s.key === section;
              return (
                <PressableScale
                  key={s.key}
                  onPress={() => setSection(s.key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  style={[styles.segment, active && styles.segmentActive]}>
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{s.label}</Text>
                </PressableScale>
              );
            })}
          </View>
        ) : null}

        {!searching && section === 'modules' ? (
          data ? (
            data.batch ? (
              <Modules data={data} overview={overview} />
            ) : (
              <Notice
                title="Join your batch first"
                body="Your modules come from your batch: your degree programme and intake year."
                action="Find your batch"
                onPress={() => router.push('/batch')}
              />
            )
          ) : status === 'error' ? (
            <View style={styles.gap}>
              <FormMessage message="Could not load your modules. Check your connection and try again." />
              <Button label="Try again" variant="quiet" onPress={refresh} />
            </View>
          ) : (
            <ModulesSkeleton />
          )
        ) : null}

        {!searching && section === 'kuppi' ? <KuppiSection refreshKey={refreshKey} /> : null}
        {!searching && section === 'explore' ? <ExploreSection refreshKey={refreshKey} /> : null}
      </View>
    </ScrollView>
  );
}

function Modules({ data, overview }: { data: BatchModules; overview: Overview | null }) {
  const { data: exams } = useMyExams();
  const theme = useTheme();
  const styles = useStyles();
  const [termOpen, setTermOpen] = useState(false);
  const [pastOpen, setPastOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const term = data.term;
  const open = (m: ModuleCard) => router.push({ pathname: '/module/[id]', params: { id: String(m.id) } });
  const editTerm = () =>
    term &&
    router.push({
      pathname: '/semester',
      params: { year: String(term.year), semester: String(term.semester) },
    });

  async function choose(m: ModuleCard, choice: 'taking' | null) {
    setBusy(m.id);
    setError(null);
    const e = await setModuleChoice(m.id, choice);
    setBusy(null);
    if (e) setError(e);
  }

  if (!term) {
    return (
      <>
        <Notice
          title="Which semester is your batch in?"
          body="Set it once and your modules for this semester come first. Your batchmates see the same."
          action="Choose your semester"
          onPress={() => setTermOpen(true)}
        />
        <TermSheet visible={termOpen} data={data} onClose={() => setTermOpen(false)} />
      </>
    );
  }

  // Exam season: modules with the nearest exams come first, each with its countdown.
  const examDays = (m: ModuleCard) =>
    exams?.exams.find((e) => e.module.id === m.id && e.days <= EXAM_SEASON_DAYS)?.days ?? Infinity;
  const ordered = [...data.current].sort((a, b) => examDays(a) - examDays(b));
  const rows: ModuleCard[][] = [];
  for (let i = 0; i < ordered.length; i += 2) rows.push(ordered.slice(i, i + 2));

  return (
    <View style={styles.gap}>
      <View style={styles.termRow}>
        <View style={styles.termCopy}>
          <Text style={styles.termTitle} accessibilityRole="header">
            {termLabel(term)}
          </Text>
          <Text style={styles.termMeta} numberOfLines={1}>
            {term.confirmed ? data.batch.name : `Waiting for your batch · ${term.votes ?? 1} of ${data.votes_needed}`}
          </Text>
        </View>
        <PressableScale
          onPress={() => setTermOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Change semester"
          hitSlop={8}
          style={styles.change}>
          <Text style={styles.changeText}>Change</Text>
        </PressableScale>
      </View>

      <FirstWeek data={data} overview={overview} />

      {term.confirmed && !data.my_term_vote && nextTerm(term) && (term.days ?? 0) > NUDGE_DAYS ? (
        <PressableScale onPress={() => setTermOpen(true)} accessibilityRole="button" style={styles.nudge}>
          <Text style={styles.nudgeText}>Has this semester ended? Move your batch on.</Text>
          <CaretRightIcon size={16} weight="bold" color={theme.onAccent} />
        </PressableScale>
      ) : null}
      {data.my_term_vote ? (
        <Text style={styles.hint}>
          You asked to move to {termLabel(data.my_term_vote)} ({data.my_term_vote.votes} of {data.votes_needed}).
        </Text>
      ) : null}

      <ExamStrip />

      {overview && overview.to_sort > 0 ? (
        <PressableScale onPress={() => router.push('/to-sort')} accessibilityRole="button" scale={0.985} style={styles.toSort}>
          <TrayIcon size={22} weight="bold" color={theme.text} />
          <View style={styles.termCopy}>
            <Text style={styles.toSortTitle}>To sort ({overview.to_sort})</Text>
            <Text style={styles.termMeta}>Files from your chats that need a module</Text>
          </View>
          <CaretRightIcon size={16} weight="bold" color={theme.textMuted} />
        </PressableScale>
      ) : null}

      {data.current.length > 0 ? (
        <View style={styles.grid}>
          {rows.map((pair) => (
            <View key={pair[0].id} style={styles.gridRow}>
              {pair.map((m) => (
                <ModuleTile
                  key={m.id}
                  module={m}
                  votesNeeded={data.votes_needed}
                  files={overview?.modules.find((x) => x.module_id === m.id)}
                  exam={Number.isFinite(examDays(m)) ? `Exam ${daysText(examDays(m))}` : null}
                  onPress={open}
                />
              ))}
              {pair.length === 1 ? <View style={styles.gridSpacer} /> : null}
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No modules for this semester yet</Text>
          <Text style={styles.emptyBody}>
            Add them once for your whole batch. Lists from other batches of your programme are suggested, so it usually takes a
            few taps.
          </Text>
        </View>
      )}

      <PressableScale onPress={editTerm} accessibilityRole="button" scale={0.985} style={styles.addRow}>
        <PlusIcon size={20} weight="bold" color={theme.accentText} />
        <Text style={styles.addText}>{data.current.length ? 'Add or change modules' : 'Set up this semester'}</Text>
      </PressableScale>

      {data.electives.length > 0 ? (
        <View style={styles.group}>
          <Text style={styles.groupTitle}>Electives this semester</Text>
          <View style={styles.card}>
            {data.electives.map((m) => (
              <CheckRow
                key={m.id}
                label={`${m.code} · ${m.name}`}
                checked={!!m.taking}
                onChange={(on) => busy === null && choose(m, on ? 'taking' : null)}
              />
            ))}
          </View>
          <Text style={styles.hint}>Tick the electives you take. Their course chats open for you.</Text>
        </View>
      ) : null}

      {data.not_taking.length > 0 ? (
        <View style={styles.group}>
          <Text style={styles.groupTitle}>Not taking</Text>
          <View style={styles.card}>
            {data.not_taking.map((m) => (
              <View key={m.id} style={styles.listRow}>
                <Text style={styles.listText} numberOfLines={1}>
                  {m.code} · {m.name}
                </Text>
                <PressableScale
                  onPress={() => busy === null && choose(m, null)}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${m.code} back`}
                  hitSlop={8}>
                  <Text style={styles.link}>Add back</Text>
                </PressableScale>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <FormMessage message={error} />

      {data.past.length > 0 ? (
        <View style={styles.group}>
          <PressableScale
            onPress={() => setPastOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityState={{ expanded: pastOpen }}
            style={styles.pastHeader}>
            <Text style={styles.groupTitle}>Past semesters ({data.past.length})</Text>
            {pastOpen ? (
              <CaretDownIcon size={16} weight="bold" color={theme.textMuted} />
            ) : (
              <CaretRightIcon size={16} weight="bold" color={theme.textMuted} />
            )}
          </PressableScale>
          {pastOpen
            ? data.past.map((p) => (
                <View key={`${p.year}-${p.semester}`} style={styles.card}>
                  <Text style={styles.pastTitle}>{termLabel(p)}</Text>
                  {p.modules.map((m) => (
                    <PressableScale key={m.id} onPress={() => open(m)} accessibilityRole="button" style={styles.listRow}>
                      <ModuleDot id={m.id} />
                      <Text style={styles.listText} numberOfLines={1}>
                        {m.code} · {m.name}
                      </Text>
                      <CaretRightIcon size={16} weight="bold" color={theme.textMuted} />
                    </PressableScale>
                  ))}
                </View>
              ))
            : null}
        </View>
      ) : null}

      <TermSheet visible={termOpen} data={data} onClose={() => setTermOpen(false)} />
    </View>
  );
}

function Notice({ title, body, action, onPress }: { title: string; body: string; action?: string; onPress?: () => void }) {
  const styles = useStyles();
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeTitle}>{title}</Text>
      <Text style={styles.noticeBody}>{body}</Text>
      {action && onPress ? <Button label={action} onPress={onPress} /> : null}
    </View>
  );
}

function ModulesSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.gap} accessibilityLabel="Loading your modules">
      <View style={[styles.skeleton, { height: 44, width: '60%' }]} />
      <View style={styles.gridRow}>
        <View style={[styles.skeleton, styles.skeletonTile]} />
        <View style={[styles.skeleton, styles.skeletonTile]} />
      </View>
      <View style={styles.gridRow}>
        <View style={[styles.skeleton, styles.skeletonTile]} />
        <View style={[styles.skeleton, styles.skeletonTile]} />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.xxxl,
  },
  stack: { gap: space.lg, width: '100%', maxWidth: 560, alignSelf: 'center' },
  gap: { gap: space.lg },
  title: {
    fontFamily: fonts.display,
    fontSize: 32,
    lineHeight: 38,
    color: t.text,
    letterSpacing: -0.3,
  },
  segments: {
    flexDirection: 'row',
    backgroundColor: t.surface,
    borderRadius: radius.pill,
    padding: 4,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: { backgroundColor: t.accent },
  segmentText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted },
  segmentTextActive: { color: t.onAccent },
  termRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  termCopy: { flex: 1, gap: 2 },
  termTitle: { fontFamily: fonts.display, fontSize: 22, color: t.text },
  termMeta: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: t.textMuted,
  },
  change: { minHeight: 40, justifyContent: 'center' },
  changeText: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.accentText },
  nudge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: t.accentTint,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  nudgeText: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: t.onAccentTint,
  },
  grid: { gap: space.md },
  gridRow: { flexDirection: 'row', gap: space.md },
  gridSpacer: { flex: 1 },
  empty: {
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    padding: space.xl,
    gap: space.sm,
  },
  emptyTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: t.textMuted,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 52,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: t.border,
    borderStyle: 'dashed',
  },
  addText: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.accentText },
  toSort: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  toSortTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  group: { gap: space.sm },
  groupTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: t.textMuted,
    paddingHorizontal: space.xs,
  },
  card: {
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 48,
  },
  listText: {
    flex: 1,
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: t.text,
  },
  link: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.accentText },
  pastHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: 36,
  },
  pastTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: t.text,
    paddingTop: space.sm,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: t.textMuted,
    paddingHorizontal: space.xs,
  },
  notice: {
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    padding: space.xl,
    gap: space.md,
  },
  noticeTitle: { fontFamily: fonts.display, fontSize: 20, color: t.text },
  noticeBody: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: t.textMuted,
  },
  skeleton: { backgroundColor: t.surface, borderRadius: radius.lg },
  skeletonTile: { flex: 1, height: 120 },
}));
