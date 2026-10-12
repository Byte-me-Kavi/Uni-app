import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { nextTerm, SEMESTERS, setBatchTerm, termLabel, YEARS_OF_STUDY, type BatchModules } from '@/lib/modules';
import { brand, createThemedStyles, fonts, radius, space } from '@/theme/tokens';


type Props = { visible: boolean; data: BatchModules; onClose: () => void };

// Which semester the batch is in. Reps (and anyone, before the batch has agreed on one) pick any
// semester; once it is set, everyone else can only ask to move on to the next one, which happens
// when enough batchmates ask.
export function TermSheet({ visible, data, onClose }: Props) {
  return (
    <BottomSheet visible={visible} title="Your semester" onClose={onClose} height={0.75}>
      {/* Mounted fresh each time the sheet opens, so it starts from the batch's semester. */}
      {visible ? <TermForm data={data} onDone={onClose} /> : null}
    </BottomSheet>
  );
}

function TermForm({ data, onDone }: { data: BatchModules; onDone: () => void }) {
  const styles = useStyles();
  const confirmed = data.term?.confirmed ?? false;
  const free = data.can_edit || !confirmed;
  const next = data.term ? nextTerm(data.term) : { year: 1, semester: 1 };
  const [year, setYear] = useState(data.term?.year ?? 1);
  const [semester, setSemester] = useState(data.term?.semester ?? 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(y: number, s: number) {
    setSaving(true);
    setError(null);
    const e = await setBatchTerm(y, s);
    setSaving(false);
    if (e) setError(e);
    else onDone();
  }

  const needed = data.votes_needed;

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {free ? (
          <>
            <Text style={styles.lead}>
              {data.can_edit
                ? 'Your whole batch sees this semester’s modules first.'
                : needed > 1
                  ? `Your batch moves to it when ${needed} batchmates choose the same semester. You see it straight away.`
                  : 'Your batch sees this semester’s modules first.'}
            </Text>
            <Text style={styles.label}>Year of study</Text>
            <View style={styles.chips}>
              {YEARS_OF_STUDY.map((y) => (
                <Chip key={y} label={`Year ${y}`} active={y === year} onPress={() => setYear(y)} />
              ))}
            </View>
            <Text style={styles.label}>Semester</Text>
            <View style={styles.chips}>
              {SEMESTERS.map((s) => (
                <Chip key={s} label={`Semester ${s}`} active={s === semester} onPress={() => setSemester(s)} />
              ))}
            </View>
            <FormMessage message={error} />
            <Button label={`Set ${termLabel({ year, semester })}`} loading={saving} onPress={() => save(year, semester)} />
          </>
        ) : !next ? (
          <Text style={styles.lead}>
            Your batch is in its final semester, {termLabel(data.term!)}. Batch reps can change it if it is wrong.
          </Text>
        ) : (
          <>
            <Text style={styles.lead}>
              Has {termLabel(data.term!)} ended? Ask to move your batch on. It moves when {needed} batchmates ask.
              Batch reps can change it any time.
            </Text>
            {data.my_term_vote ? (
              <Text style={styles.note}>
                You asked for {termLabel(data.my_term_vote)} ({data.my_term_vote.votes} of {needed}).
              </Text>
            ) : null}
            <FormMessage message={error} />
            <Button label={`Move to ${termLabel(next)}`} loading={saving} onPress={() => save(next.year, next.semester)} />
          </>
        )}
    </ScrollView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const styles = useStyles();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </PressableScale>
  );
}

const useStyles = createThemedStyles((t) => ({
  body: { paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.md },
  lead: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: t.textMuted },
  note: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: t.text },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text, marginTop: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + 2,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: t.border,
    backgroundColor: t.surface,
  },
  // Selected: the accent with Ink text (brand rule).
  chipActive: { backgroundColor: brand.accent, borderColor: brand.accent },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  chipTextActive: { color: brand.ink },
}));
