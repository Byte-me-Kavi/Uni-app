import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { ActionSheet } from '@/components/ui/action-sheet';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { daysText, EXAM_KINDS, examLabel, removeExam, setExam, useMyExams, type Exam, type ExamKind } from '@/lib/exams';
import { useMyModules } from '@/lib/modules';
import { brand, createThemedStyles, fonts, radius, space } from '@/theme/tokens';

const TIMES = Array.from({ length: 21 }, (_, i) => ({ hour: 8 + Math.floor(i / 2), minute: (i % 2) * 30 })); // 8:00 to 18:00
const timeLabel = (t: { hour: number; minute: number }) =>
  `${t.hour % 12 === 0 ? 12 : t.hour % 12}${t.minute ? `:${String(t.minute).padStart(2, '0')}` : ''} ${t.hour < 12 ? 'am' : 'pm'}`;

// The batch's exam dates. Everyone sees the countdowns; reps (or anyone, in a batch without reps)
// add and change them once for the whole batch.
export default function Exams() {
  const styles = useStyles();
  const params = useLocalSearchParams<{ module?: string }>();
  const { data } = useMyExams();
  const { data: modules } = useMyModules();
  const current = modules?.batch ? modules.current.filter((m) => !m.pending) : [];
  const [removing, setRemoving] = useState<Exam | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The form.
  const [days] = useState(() => {
    const today = new Date();
    return Array.from({ length: 120 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
  });
  const [moduleId, setModuleId] = useState<number | null>(params.module ? Number(params.module) : null);
  const [kind, setKind] = useState<ExamKind>('final');
  const [day, setDay] = useState(7);
  const [time, setTime] = useState(TIMES[2]);
  const [venue, setVenue] = useState('');
  const [saving, setSaving] = useState(false);

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

  const exams = data?.exams ?? [];

  return (
    <Screen style={styles.screen}>
      <BackHeader title="Exams" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.stack}>
            {exams.length > 0 ? (
              <View style={styles.card}>
                {exams.map((e) => (
                  <PressableScale
                    key={e.id}
                    onPress={() => router.push({ pathname: '/module/[id]', params: { id: String(e.module.id) } })}
                    onLongPress={() => data?.can_edit && setRemoving(e)}
                    accessibilityRole="button"
                    accessibilityHint={data?.can_edit ? 'Long press to remove' : undefined}
                    style={styles.row}>
                    <View style={styles.days}>
                      <Text style={styles.daysNumber}>{Math.max(e.days, 0)}</Text>
                      <Text style={styles.daysLabel}>{e.days === 1 ? 'day' : 'days'}</Text>
                    </View>
                    <View style={styles.copy}>
                      <Text style={styles.code}>{e.module.code}</Text>
                      <Text style={styles.title}>
                        {examLabel(e.kind)} {daysText(e.days)}
                      </Text>
                      <Text style={styles.meta}>
                        {new Date(e.starts_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                        {e.venue ? ` · ${e.venue}` : ''}
                      </Text>
                    </View>
                  </PressableScale>
                ))}
              </View>
            ) : (
              <Text style={styles.lead}>No exam dates yet. {data?.can_edit ? 'Add them below, once for your whole batch.' : 'Your batch reps add them.'}</Text>
            )}

            {data?.can_edit ? (
              <View style={styles.form}>
                <Text style={styles.formTitle} accessibilityRole="header">
                  Add or change a date
                </Text>
                <Group label="Module">
                  <View style={styles.chips}>
                    {current.map((m) => (
                      <Chip key={m.id} label={m.code} active={m.id === moduleId} onPress={() => setModuleId(m.id)} />
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
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.line}>
                    {days.map((d, i) => (
                      <Chip
                        key={d.toISOString()}
                        label={i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                        active={i === day}
                        onPress={() => setDay(i)}
                      />
                    ))}
                  </ScrollView>
                </Group>
                <Group label="Time">
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.line}>
                    {TIMES.map((t) => (
                      <Chip key={`${t.hour}:${t.minute}`} label={timeLabel(t)} active={t === time} onPress={() => setTime(t)} />
                    ))}
                  </ScrollView>
                </Group>
                <TextField label="Venue (optional)" value={venue} onChangeText={setVenue} placeholder="e.g. Main Hall" maxLength={160} />
                <Text style={styles.meta}>Setting the same module and kind again moves it. Your batch sees who set it.</Text>
                <FormMessage message={error} />
                <Button label="Save date" loading={saving} onPress={save} />
              </View>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <ActionSheet
        visible={!!removing}
        title={removing ? `${removing.module.code} · ${examLabel(removing.kind)}` : undefined}
        actions={[
          {
            label: 'Remove this date',
            destructive: true,
            onPress: async () => {
              if (!removing) return;
              const e = await removeExam(removing.id);
              if (e) setError(e);
            },
          },
        ]}
        onClose={() => setRemoving(null)}
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

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const styles = useStyles();
  return (
    <PressableScale onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: active }} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </PressableScale>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  flex: { flex: 1 },
  content: { padding: space.xl, paddingBottom: space.xxxl },
  stack: { gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  lead: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: t.textMuted },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm },
  days: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: brand.accent, alignItems: 'center', justifyContent: 'center' },
  // Ink on the accent (brand rule).
  daysNumber: { fontFamily: fonts.display, fontSize: 22, lineHeight: 26, color: brand.ink },
  daysLabel: { fontFamily: fonts.bodyBold, fontSize: 11, color: brand.ink },
  copy: { flex: 1, gap: 1 },
  code: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.accentText },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  meta: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: t.textMuted },
  form: { gap: space.lg },
  formTitle: { fontFamily: fonts.display, fontSize: 20, color: t.text },
  group: { gap: space.sm },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  line: { gap: space.sm, paddingRight: space.xl },
  chip: {
    paddingHorizontal: space.md + 2,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: t.border,
    backgroundColor: t.surface,
  },
  chipActive: { backgroundColor: brand.accent, borderColor: brand.accent },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  chipTextActive: { color: brand.ink },
}));
