import { router, useLocalSearchParams } from 'expo-router';
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { DotsThreeVerticalIcon } from 'phosphor-react-native/src/icons/DotsThreeVertical';

import { ModuleDot } from '@/components/resources/module-dot';
import { ModuleChip } from '@/components/resources/module-chip';
import { ActionSheet } from '@/components/ui/action-sheet';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { dayAndTime, weekdayDayMonth } from '@/lib/dates';
import {
  daysText,
  daysUntil,
  EXAM_KINDS,
  examLabel,
  removeExam,
  setExam,
  useMyExams,
  type Exam,
  type ExamKind,
} from '@/lib/exams';
import { useMyModules } from '@/lib/modules';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// Every half hour from 5 am to 11:30 pm, and 11:59 pm for assignment deadlines.
const TIMES = [
  ...Array.from({ length: 37 }, (_, i) => ({ hour: 5 + Math.floor(i / 2), minute: (i % 2) * 30 })),
  { hour: 23, minute: 59 },
];
const START_TIME = TIMES.findIndex((t) => t.hour === 9 && t.minute === 0);
// Time chips have one width, so the list can open scrolled to the chosen time without measuring.
const TIME_CHIP = 92;
const timeLayout = (_: unknown, index: number) => ({ length: TIME_CHIP, offset: (TIME_CHIP + space.sm) * index, index });
const timeLabel = (t: { hour: number; minute: number }) =>
  `${t.hour % 12 === 0 ? 12 : t.hour % 12}${t.minute ? `:${String(t.minute).padStart(2, '0')}` : ''} ${t.hour < 12 ? 'am' : 'pm'}`;

// The batch's exam dates. Everyone sees the countdowns; reps (or anyone, in a batch without reps)
// add and change them once for the whole batch.
export default function Exams() {
  const theme = useTheme();
  const styles = useStyles();
  const params = useLocalSearchParams<{ module?: string }>();
  const { data } = useMyExams();
  const { data: modules } = useMyModules();
  const current = modules?.batch ? modules.current.filter((m) => !m.pending) : [];
  // The date whose menu is open (change or remove it).
  const [menu, setMenu] = useState<Exam | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);

  // The form.
  const [days] = useState(() => {
    const today = new Date();
    return Array.from({ length: 120 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
  });
  const [moduleId, setModuleId] = useState<number | null>(params.module ? Number(params.module) : null);
  const [kind, setKind] = useState<ExamKind>('final');
  const [day, setDay] = useState(7);
  const [time, setTime] = useState(TIMES[START_TIME]);
  const [venue, setVenue] = useState('');
  const [saving, setSaving] = useState(false);
  // The form is drawn a frame after the screen, so the screen opens at once.
  const [formReady, setFormReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setFormReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  async function save() {
    if (!moduleId) return setError('Choose the module.');
    const at = new Date(days[day]);
    at.setHours(time.hour, time.minute, 0, 0);
    setSaving(true);
    setError(null);
    const e = await setExam(moduleId, kind, at, venue);
    setSaving(false);
    if (e) return setError(e);
    setVenue('');
  }

  // "Change this date": the form takes the date's details, and the screen scrolls to it.
  function change(e: Exam) {
    const at = new Date(e.starts_at);
    setModuleId(e.module.id);
    setKind(e.kind);
    setDay(Math.min(Math.max(daysUntil(e.starts_at), 0), days.length - 1));
    const minutes = at.getHours() * 60 + at.getMinutes();
    setTime(
      TIMES.reduce((best, t) =>
        Math.abs(t.hour * 60 + t.minute - minutes) < Math.abs(best.hour * 60 + best.minute - minutes) ? t : best,
      ),
    );
    setVenue(e.venue ?? '');
    setError(null);
    requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: true }));
  }

  async function remove(e: Exam) {
    setListError(null);
    const message = await removeExam(e.id);
    if (message) setListError(message);
  }

  const exams = data?.exams ?? [];

  return (
    <Screen style={styles.screen}>
      <BackHeader title="Exams" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.stack}>
            {exams.length > 0 ? (
              <View style={styles.card}>
                {exams.map((e) => (
                  <View key={e.id} style={styles.rowWrap}>
                    <PressableScale
                      onPress={() => router.push({ pathname: '/module/[id]', params: { id: String(e.module.id) } })}
                      onLongPress={() => data?.can_edit && setMenu(e)}
                      accessibilityRole="button"
                      style={[styles.row, styles.flex]}>
                      <View style={styles.days}>
                        {e.days <= 0 ? (
                          <Text style={styles.daysToday}>Today</Text>
                        ) : (
                          <>
                            <Text style={styles.daysNumber}>{e.days}</Text>
                            <Text style={styles.daysLabel}>{e.days === 1 ? 'day' : 'days'}</Text>
                          </>
                        )}
                      </View>
                      <View style={styles.copy}>
                        <View style={styles.moduleLine}>
                          <ModuleDot id={e.module.id} size={8} />
                          <Text style={[styles.code, styles.shrink]} numberOfLines={1}>
                            {e.module.code} · {e.module.name}
                          </Text>
                        </View>
                        <Text style={styles.title}>
                          {examLabel(e.kind)} {daysText(e.days)}
                        </Text>
                        <Text style={styles.meta}>
                          {dayAndTime(e.starts_at)}
                          {e.venue ? ` · ${e.venue}` : ''}
                        </Text>
                      </View>
                    </PressableScale>
                    {data?.can_edit ? (
                      <Pressable
                        onPress={() => setMenu(e)}
                        accessibilityRole="button"
                        accessibilityLabel={`Change or remove ${e.module.name} ${examLabel(e.kind)}`}
                        hitSlop={8}
                        style={styles.more}>
                        <DotsThreeVerticalIcon size={22} weight="bold" color={theme.textMuted} />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
            <FormMessage message={listError} />
            {exams.length === 0 ? (
              <Text style={styles.lead}>
                No exam dates yet. {data?.can_edit ? 'Add them below, once for your whole batch.' : 'Your batch reps add them.'}
              </Text>
            ) : null}

            {data?.can_edit && formReady ? (
              <View style={styles.form}>
                <Text style={styles.formTitle} accessibilityRole="header">
                  Add or change a date
                </Text>
                <Group label="Module">
                  <View style={styles.chips}>
                    {current.map((m) => (
                      <ModuleChip
                        key={m.id}
                        id={m.id}
                        code={m.code}
                        name={m.name}
                        active={m.id === moduleId}
                        onPress={() => setModuleId(m.id)}
                      />
                    ))}
                  </View>
                </Group>
                <Group label="What">
                  <View style={styles.chips}>
                    {EXAM_KINDS.map((k) => (
                      <Chip key={k.key} label={k.label} active={k.key === kind} onPress={() => setKind(k.key)} />
                    ))}
                  </View>
                </Group>
                <Group label="Day">
                  {/* Four months of days: only the ones on screen are drawn. */}
                  <FlatList
                    horizontal
                    data={days}
                    keyExtractor={(d) => String(d.getTime())}
                    extraData={day}
                    renderItem={({ item, index }) => (
                      <Chip
                        label={index === 0 ? 'Today' : weekdayDayMonth(item)}
                        active={index === day}
                        onPress={() => setDay(index)}
                      />
                    )}
                    initialNumToRender={6}
                    maxToRenderPerBatch={10}
                    windowSize={5}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.line}
                  />
                </Group>
                <Group label="Time">
                  <FlatList
                    horizontal
                    data={TIMES}
                    keyExtractor={(t) => `${t.hour}:${t.minute}`}
                    extraData={time}
                    renderItem={({ item }) => (
                      <Chip fixed label={timeLabel(item)} active={item === time} onPress={() => setTime(item)} />
                    )}
                    getItemLayout={timeLayout}
                    initialScrollIndex={Math.max(START_TIME - 1, 0)}
                    initialNumToRender={6}
                    maxToRenderPerBatch={8}
                    windowSize={5}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.line}
                  />
                </Group>
                <TextField
                  label="Venue (optional)"
                  value={venue}
                  onChangeText={setVenue}
                  placeholder="e.g. Main Hall"
                  maxLength={160}
                />
                <Text style={styles.meta}>Setting the same module and kind again moves it. Your batch sees who set it.</Text>
                <FormMessage message={error} />
                <Button label="Save date" loading={saving} onPress={save} />
              </View>
            ) : data?.can_edit ? (
              <FormPlaceholder />
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <ActionSheet
        visible={!!menu}
        title={menu ? `${menu.module.name} · ${examLabel(menu.kind)}` : undefined}
        message="Changes are for your whole batch."
        actions={
          menu
            ? [
                { label: 'Change this date', onPress: () => change(menu) },
                { label: 'Remove this date', destructive: true, onPress: () => remove(menu) },
              ]
            : []
        }
        onClose={() => setMenu(null)}
      />
    </Screen>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

// The form's shape while it is drawn (a frame after the screen), so the screen is never blank.
function FormPlaceholder() {
  const styles = useStyles();
  return (
    <View style={styles.form} accessibilityLabel="Loading the form">
      <Text style={styles.formTitle}>Add or change a date</Text>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.group}>
          <View style={[styles.placeholder, styles.placeholderLabel]} />
          <View style={[styles.placeholder, styles.placeholderChips]} />
        </View>
      ))}
    </View>
  );
}

// A plain pressable (no spring animation): the form has dozens of these, and each animated one costs
// time to set up when the screen opens.
const Chip = memo(function Chip({
  label,
  active,
  onPress,
  fixed = false,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  fixed?: boolean;
}) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.chip,
        fixed && styles.chipFixed,
        active && styles.chipActive,
        pressed && styles.chipPressed,
      ]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
});

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  flex: { flex: 1 },
  content: { padding: space.xl, paddingBottom: space.xxxl },
  stack: { gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  lead: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: t.textMuted },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm },
  days: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Ink on the accent (brand rule).
  daysNumber: { fontFamily: fonts.display, fontSize: 22, lineHeight: 26, color: t.onAccent },
  daysLabel: { fontFamily: fonts.bodyBold, fontSize: 11, color: t.onAccent },
  daysToday: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.onAccent },
  rowWrap: { flexDirection: 'row', alignItems: 'center' },
  more: { width: 40, height: 48, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 1 },
  code: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.accentText },
  moduleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shrink: { flexShrink: 1 },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  meta: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: t.textMuted },
  form: { gap: space.lg },
  formTitle: { fontFamily: fonts.display, fontSize: 20, color: t.text },
  group: { gap: space.sm },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  line: { gap: space.sm, paddingRight: space.xl },
  chipPressed: { opacity: 0.6 },
  chipFixed: { width: TIME_CHIP, alignItems: 'center', paddingHorizontal: 0 },
  placeholder: { backgroundColor: t.surface, borderRadius: radius.md },
  placeholderLabel: { height: 16, width: 90 },
  placeholderChips: { height: 40 },
  chip: {
    paddingHorizontal: space.md + 2,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: t.border,
    backgroundColor: t.surface,
  },
  chipActive: { backgroundColor: t.accent, borderColor: t.accent },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  chipTextActive: { color: t.onAccent },
}));
