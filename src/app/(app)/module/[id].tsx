import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { ChatsCircleIcon } from 'phosphor-react-native/src/icons/ChatsCircle';
import { PaletteIcon } from 'phosphor-react-native/src/icons/Palette';

import { ColourSheet } from '@/components/resources/colour-sheet';
import { useItemControls } from '@/components/resources/item-controls';
import { ItemRow } from '@/components/resources/item-row';
import { KuppiForModule, SharedForModule } from '@/components/resources/module-tabs';
import { OfflineCard } from '@/components/resources/offline-card';

import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { KeyboardScroll } from '@/components/ui/keyboard';
import { openChat } from '@/lib/chat/open-chat';
import { dayAndTime } from '@/lib/dates';
import { daysText, EXAM_SEASON_DAYS, examLabel, nextExamFor, useMyExams } from '@/lib/exams';
import { categoryLabel, useModuleLibrary, type Category } from '@/lib/library';
import { useModuleColour } from '@/lib/module-colours';
import {
  findCard,
  renameModule,
  setModuleChoice,
  termLabel,
  useMyModules,
  type BatchModules,
  type ModuleCard,
} from '@/lib/modules';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Place = 'current' | 'elective' | 'not_taking' | 'past';
type Tab = 'files' | 'shared' | 'kuppi';
const TABS: { key: Tab; label: string }[] = [
  { key: 'files', label: 'My files' },
  { key: 'shared', label: 'Shared' },
  { key: 'kuppi', label: 'Kuppi' },
];

function placeOf(data: BatchModules, m: ModuleCard): { place: Place; term: { year: number; semester: number } | null } {
  if (data.current.some((c) => c.id === m.id) && m.kind !== 'elective') return { place: 'current', term: data.term };
  if (data.electives.some((c) => c.id === m.id)) return { place: 'elective', term: data.term };
  if (data.not_taking.some((c) => c.id === m.id)) return { place: 'not_taking', term: data.term };
  const past = data.past.find((p) => p.modules.some((c) => c.id === m.id));
  return { place: 'past', term: past ? { year: past.year, semester: past.semester } : null };
}

// One module, in one place: its course chat; My files (from the student's chats, sorted into
// folders); Shared (what students at the university published); Kuppi; and the student's choice
// (taking it, not taking it, repeating it).
export default function Module() {
  const theme = useTheme();
  const styles = useStyles();
  const { id, tab: startTab } = useLocalSearchParams<{ id: string; tab?: Tab }>();
  const { data, status } = useMyModules();
  const [tab, setTab] = useState<Tab>(startTab === 'shared' || startTab === 'kuppi' ? startTab : 'files');
  // Exam season: the banner jumps straight to past papers (a fresh list each time).
  const [focus, setFocus] = useState<{ category: Category | null; n: number }>({ category: null, n: 0 });
  const { data: exams } = useMyExams();
  const card = findCard(data, Number(id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [colourOpen, setColourOpen] = useState(false);
  const colour = useModuleColour(Number(id));

  if (!data || !data.batch || !card) {
    return (
      <Screen style={styles.screen}>
        <BackHeader />
        <View style={styles.center}>
          {status === 'loading' || status === 'idle' ? (
            <ActivityIndicator color={theme.accentText} />
          ) : (
            <Text style={styles.muted}>This module is no longer in your lists.</Text>
          )}
        </View>
      </Screen>
    );
  }

  const batch = data;
  const { place, term } = placeOf(batch, card);
  const exam = nextExamFor(exams, card.id);
  const pastPapers = (where: 'files' | 'shared') => {
    setTab(where);
    setFocus((f) => ({ category: 'past_papers', n: f.n + 1 }));
  };
  const repeating = card.kind === 'repeat';

  async function choose(choice: 'taking' | 'not_taking' | 'repeat' | null) {
    setBusy(true);
    setError(null);
    const e = await setModuleChoice(card!.id, choice);
    setBusy(false);
    if (e) setError(e);
  }

  async function saveName() {
    setBusy(true);
    setError(null);
    const e = await renameModule(card!.id, name);
    setBusy(false);
    if (e) setError(e);
    else setRenaming(false);
  }

  const meta = [
    card.pending ? `Waiting for batchmates · ${card.votes ?? 1} of ${batch.votes_needed}` : null,
    repeating ? 'Repeating' : place === 'elective' ? 'Elective' : place === 'not_taking' ? 'Not taking' : null,
    term && !repeating ? termLabel(term) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen style={styles.screen}>
      <BackHeader title={card.name} />
      <KeyboardScroll contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.stack}>
          <View style={[styles.head, { backgroundColor: colour.bg }]}>
            <View style={styles.headTop}>
              <Text style={[styles.code, { color: colour.fg }]}>{card.code}</Text>
              <PressableScale
                onPress={() => setColourOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={`Colour: ${colour.label}. Change`}
                hitSlop={8}
                style={styles.colourButton}>
                <PaletteIcon size={18} weight="bold" color={colour.fg} />
                <Text style={[styles.colourText, { color: colour.fg }]}>Colour</Text>
              </PressableScale>
            </View>
            <Text style={styles.name} accessibilityRole="header">
              {card.name}
            </Text>
            {meta ? <Text style={styles.muted}>{meta}</Text> : null}
          </View>

          {exam && exam.days <= EXAM_SEASON_DAYS ? (
            <View style={styles.exam}>
              <Text style={styles.examTitle}>
                {examLabel(exam.kind)} {daysText(exam.days)}
              </Text>
              <Text style={styles.examBody}>
                {dayAndTime(exam.starts_at)}
                {exam.venue ? ` · ${exam.venue}` : ''}
              </Text>
              <View style={styles.examActions}>
                <PressableScale onPress={() => pastPapers('shared')} accessibilityRole="button" style={styles.examButton}>
                  <Text style={styles.examButtonText}>Shared past papers</Text>
                </PressableScale>
                <PressableScale onPress={() => pastPapers('files')} accessibilityRole="button" style={styles.examButton}>
                  <Text style={styles.examButtonText}>My past papers</Text>
                </PressableScale>
              </View>
            </View>
          ) : null}

          {card.chat_id ? (
            <PressableScale onPress={() => openChat(card.chat_id!)} accessibilityRole="button" scale={0.985} style={styles.chat}>
              <ChatsCircleIcon size={24} weight="bold" color={theme.onAccent} />
              <View style={styles.chatCopy}>
                <Text style={styles.chatTitle}>Course chat</Text>
                <Text style={styles.chatBody}>Everyone in your intake taking {card.name}</Text>
              </View>
            </PressableScale>
          ) : null}

          <View style={styles.segments} accessibilityRole="tablist">
            {TABS.map((t) => (
              <PressableScale
                key={t.key}
                onPress={() => setTab(t.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t.key }}
                style={[styles.segment, tab === t.key && styles.segmentActive]}>
                <Text style={[styles.segmentText, tab === t.key && styles.segmentTextActive]}>{t.label}</Text>
              </PressableScale>
            ))}
          </View>

          {tab === 'files' ? (
            <>
              <OfflineCard moduleId={card.id} />
              <ModuleLibrary key={`files-${focus.n}`} moduleId={card.id} code={card.code} initialCategory={focus.category} />
            </>
          ) : null}
          {tab === 'shared' ? (
            <SharedForModule
              key={`shared-${focus.n}`}
              moduleId={card.id}
              initialCategory={focus.category === 'past_papers' ? 'past_papers' : null}
            />
          ) : null}
          {tab === 'kuppi' ? <KuppiForModule moduleId={card.id} /> : null}

          <FormMessage message={error} />

          <View style={styles.actions}>
            {place === 'current' && !card.pending && !repeating ? (
              <Button label="I'm not taking this" variant="quiet" loading={busy} onPress={() => choose('not_taking')} />
            ) : null}
            {place === 'elective' ? (
              <Button
                label={card.taking ? 'I’m not taking this elective' : 'I take this elective'}
                variant={card.taking ? 'quiet' : 'primary'}
                loading={busy}
                onPress={() => choose(card.taking ? null : 'taking')}
              />
            ) : null}
            {place === 'not_taking' ? (
              <Button label="I'm taking this after all" loading={busy} onPress={() => choose(null)} />
            ) : null}
            {place === 'past' ? (
              <Button label="I'm repeating this" variant="quiet" loading={busy} onPress={() => choose('repeat')} />
            ) : null}
            {repeating ? <Button label="Stop repeating" variant="quiet" loading={busy} onPress={() => choose(null)} /> : null}
          </View>

          {batch.can_edit && !card.pending ? (
            renaming ? (
              <View style={styles.rename}>
                <TextField label="Module name" value={name} onChangeText={setName} autoCapitalize="words" autoFocus />
                <Button label="Save name" loading={busy} onPress={saveName} />
                <Button label="Cancel" variant="quiet" onPress={() => setRenaming(false)} />
              </View>
            ) : (
              <PressableScale
                onPress={() => {
                  setName(card.name);
                  setRenaming(true);
                }}
                accessibilityRole="button"
                hitSlop={8}
                style={styles.renameLink}>
                <Text style={styles.link}>Rename module</Text>
                <Text style={styles.muted}>The code stays the same; every batch sees the new name.</Text>
              </PressableScale>
            )
          ) : null}

          {place === 'current' || place === 'elective' ? (
            <PressableScale
              onPress={() =>
                term &&
                router.push({ pathname: '/semester', params: { year: String(term.year), semester: String(term.semester) } })
              }
              accessibilityRole="button"
              hitSlop={8}>
              <Text style={styles.link}>Change this semester&apos;s modules</Text>
            </PressableScale>
          ) : null}
        </View>
      </KeyboardScroll>
      <ColourSheet visible={colourOpen} moduleId={card.id} name={card.name} onClose={() => setColourOpen(false)} />
    </Screen>
  );
}

function ModuleLibrary({
  moduleId,
  code,
  initialCategory = null,
}: {
  moduleId: number;
  code: string;
  initialCategory?: Category | null;
}) {
  const [category, setCategory] = useState<Category | null>(initialCategory);
  // A fresh list per folder, so switching never shows the last folder's files.
  return <Folder key={category ?? 'all'} moduleId={moduleId} code={code} category={category} onCategory={setCategory} />;
}

type FolderProps = { moduleId: number; code: string; category: Category | null; onCategory: (c: Category | null) => void };

function Folder({ moduleId, code, category, onCategory }: FolderProps) {
  const theme = useTheme();
  const styles = useStyles();
  const { data, status, more, reload, loadMore } = useModuleLibrary(moduleId, category);
  const controls = useItemControls(reload);
  const folders = data?.folders ?? [];
  const total = folders.reduce((sum, f) => sum + f.count, 0);

  return (
    <View style={styles.library}>
      {folders.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <FolderChip label={`All ${total}`} active={category === null} onPress={() => onCategory(null)} />
          {folders.map((f) => (
            <FolderChip
              key={f.category}
              label={`${categoryLabel(f.category)} ${f.count}`}
              active={category === f.category}
              onPress={() => onCategory(f.category)}
            />
          ))}
        </ScrollView>
      ) : null}

      {status === 'loading' && !data ? <ActivityIndicator color={theme.accentText} style={styles.spinner} /> : null}
      {status === 'error' && !data ? (
        <View style={styles.gap}>
          <FormMessage message="Could not load the files. Check your connection and try again." />
          <Button label="Try again" variant="quiet" onPress={reload} />
        </View>
      ) : null}

      {data && data.pinned && data.pinned.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Pinned</Text>
          {data.pinned.map((item) => (
            <ItemRow key={item.id} item={item} onOpen={controls.open} onMore={controls.more} note={controls.notes[item.id]} />
          ))}
        </View>
      ) : null}

      {data && data.items.length > 0 ? (
        <View style={styles.card}>
          {data.items.map((item) => (
            <ItemRow key={item.id} item={item} onOpen={controls.open} onMore={controls.more} note={controls.notes[item.id]} />
          ))}
          {more ? (
            <PressableScale onPress={loadMore} accessibilityRole="button" style={styles.loadMore}>
              <Text style={styles.link}>Load more</Text>
            </PressableScale>
          ) : null}
        </View>
      ) : null}

      {data && data.items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>
            {category ? `No ${categoryLabel(category).toLowerCase()} yet` : 'Nothing here yet'}
          </Text>
          <Text style={styles.muted}>
            Documents and study links shared in your course chat, or in your batch group and direct messages when they mention{' '}
            {code}, collect here by themselves. To file anything else, long-press it in a chat and choose Save to Resources.
          </Text>
        </View>
      ) : null}

      {controls.elements}
    </View>
  );
}

function FolderChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const styles = useStyles();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </PressableScale>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  content: { padding: space.xl, paddingBottom: space.xxxl },
  stack: { gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  // Tinted in the module's colour (see module-colours.ts).
  head: { gap: space.xs, borderRadius: radius.lg, padding: space.lg },
  headTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  code: { fontFamily: fonts.display, fontSize: 18 },
  colourButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36 },
  colourText: { fontFamily: fonts.bodyBold, fontSize: 14 },
  name: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: t.text, letterSpacing: -0.3 },
  muted: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.textMuted },
  // The accent with Ink text and icon (brand rule).
  chat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: t.accent,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  chatCopy: { flex: 1, gap: 1 },
  chatTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.onAccent },
  chatBody: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: t.onAccent },
  library: { gap: space.md },
  // Exam countdown: the accent with Ink text (brand rule).
  exam: { backgroundColor: t.accent, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  examTitle: { fontFamily: fonts.display, fontSize: 20, color: t.onAccent },
  examBody: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: t.onAccent },
  examActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  examButton: { backgroundColor: brand.white, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.sm },
  examButtonText: { fontFamily: fonts.bodyBold, fontSize: 14, color: brand.ink },
  segments: { flexDirection: 'row', backgroundColor: t.surface, borderRadius: radius.pill, padding: 4 },
  segment: { flex: 1, minHeight: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: t.accent },
  segmentText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted },
  segmentTextActive: { color: t.onAccent },
  chips: { gap: space.sm, paddingRight: space.xl },
  chip: {
    paddingHorizontal: space.md + 2,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: t.border,
    backgroundColor: t.surface,
  },
  // Selected: the accent with Ink text (brand rule).
  chipActive: { backgroundColor: t.accent, borderColor: t.accent },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  chipTextActive: { color: t.onAccent },
  spinner: { paddingVertical: space.xl },
  gap: { gap: space.md },
  card: {
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    paddingLeft: space.md,
    paddingRight: space.xs,
    paddingVertical: space.xs,
  },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.textMuted, paddingTop: space.sm },
  loadMore: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  empty: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.xl, gap: space.sm },
  emptyTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  actions: { gap: space.md },
  rename: { gap: space.md },
  renameLink: { gap: 2 },
  link: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.accentText },
}));
