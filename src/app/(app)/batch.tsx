import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { CaretLeftIcon } from 'phosphor-react-native/src/icons/CaretLeft';
import { UsersThreeIcon } from 'phosphor-react-native/src/icons/UsersThree';

import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { supabase } from '@/lib/supabase';
import { useHomeData } from '@/providers/home-provider';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Suggestion = {
  email_code: string | null;
  intake_year: number | null;
  programme: { id: number; name: string; members: number } | null;
  current_batch: { name: string; programme: string; intake_year: number; members: number } | null;
};
type Match = { id: number; name: string; members: number };
type Joined = { name: string; programme: string; intake_year: number; members: number };

const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 8 }, (_, i) => THIS_YEAR + 1 - i);

function members(n: number) {
  return n === 1 ? '1 student' : `${n} students`;
}

// Find your batch: the email suggests one (confirm with one tap); otherwise type the programme,
// pick from matching batches at your university, and choose the intake year.
export default function Batch() {
  const theme = useTheme();
  const styles = useStyles();
  const { refresh } = useHomeData();

  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [mode, setMode] = useState<'loading' | 'confirm' | 'form' | 'done'>('loading');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Match | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<Joined | null>(null);

  useEffect(() => {
    supabase.rpc('batch_suggestion').then(({ data, error: e }) => {
      if (e || !data) {
        setError('Could not load your batch suggestion. You can still type your programme.');
        setMode('form');
        return;
      }
      const s = data as Suggestion;
      setSuggestion(s);
      setYear(s.intake_year);
      if (s.current_batch) {
        setJoined(s.current_batch);
        setMode('done');
      } else {
        setMode(s.programme ? 'confirm' : 'form');
      }
    });
  }, []);

  // Matching batches at your university as you type; stale responses are ignored.
  useEffect(() => {
    if (mode !== 'form') return;
    let current = true;
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc('search_programmes', { p_query: query, p_intake_year: year ?? undefined });
      if (current) setMatches((data as Match[] | null) ?? []);
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, year, mode]);

  async function join(programmeId: number | null, programmeName: string | null, intakeYear: number | null) {
    if (!intakeYear) {
      setError('Choose your intake year.');
      return;
    }
    if (!programmeId && (!programmeName || programmeName.trim().length < 2)) {
      setError('Type your degree programme.');
      return;
    }
    setJoining(true);
    setError(null);
    const { data, error: e } = await supabase.rpc('join_batch', {
      p_programme_id: programmeId ?? undefined,
      p_programme_name: programmeId ? undefined : programmeName?.trim(),
      p_intake_year: intakeYear,
    });
    setJoining(false);
    if (e || !data) {
      setError(e?.message ?? 'Could not join the batch. Try again.');
      return;
    }
    setJoined(data as Joined);
    setMode('done');
    refresh();
  }

  function pick(match: Match) {
    setSelected(match);
    setQuery(match.name);
    setError(null);
  }

  // Typing after picking a match means the student wants a different name.
  const chosen = selected && selected.name === query ? selected : null;

  return (
    <Screen style={styles.screen}>
      <View style={styles.topBar}>
        <PressableScale
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          style={styles.back}>
          <CaretLeftIcon size={22} weight="bold" color={theme.text} />
        </PressableScale>
        <Text style={styles.barTitle} accessibilityRole="header">
          Your batch
        </Text>
        <View style={styles.back} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {mode === 'confirm' && suggestion?.programme ? (
            <View style={styles.stack}>
              <Text style={styles.title}>Is this your batch?</Text>
              <Text style={styles.lead}>We matched it from your university email.</Text>
              <View style={styles.batchCard}>
                <View style={styles.batchIcon}>
                  <UsersThreeIcon size={26} weight="bold" color={brand.ink} />
                </View>
                <Text style={styles.batchName}>{suggestion.programme.name}</Text>
                <Text style={styles.batchMeta}>
                  {suggestion.intake_year} intake · {members(suggestion.programme.members)} already joined
                </Text>
              </View>
              <FormMessage message={error} />
              <Button
                label="Yes, join this batch"
                loading={joining}
                onPress={() => join(suggestion.programme!.id, null, suggestion.intake_year)}
              />
              <Button label="No, change it" variant="quiet" onPress={() => setMode('form')} />
            </View>
          ) : null}

          {mode === 'form' ? (
            <View style={styles.stack}>
              <Text style={styles.title}>Find your batch</Text>
              <Text style={styles.lead}>
                Your batch is your degree programme and intake year at your university. You will join its group
                chat.
              </Text>

              <TextField
                label="Degree programme"
                value={query}
                onChangeText={(t) => {
                  setQuery(t);
                  setError(null);
                }}
                placeholder="e.g. BSc in Computer Science"
                autoCapitalize="words"
                autoCorrect={false}
                hint="Pick your batch from the list if it is there, so you join the same group as your batchmates."
              />

              {matches.length > 0 ? (
                <View style={styles.matches} accessibilityLabel="Matching batches">
                  {matches.map((m) => {
                    const active = chosen?.id === m.id;
                    return (
                      <PressableScale
                        key={m.id}
                        scale={0.985}
                        onPress={() => pick(m)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`${m.name}, ${members(m.members)}`}
                        style={[styles.match, active && styles.matchActive]}>
                        <Text style={styles.matchName}>{m.name}</Text>
                        <Text style={styles.matchMeta}>{year ? members(m.members) : ''}</Text>
                      </PressableScale>
                    );
                  })}
                </View>
              ) : null}

              <View style={styles.yearBlock}>
                <Text style={styles.label}>Intake year</Text>
                <View style={styles.years}>
                  {YEARS.map((y) => {
                    const active = y === year;
                    return (
                      <PressableScale
                        key={y}
                        onPress={() => setYear(y)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`${y} intake`}
                        style={[styles.year, active && styles.yearActive]}>
                        <Text style={[styles.yearText, active && styles.yearTextActive]}>{y}</Text>
                      </PressableScale>
                    );
                  })}
                </View>
                {suggestion?.intake_year ? (
                  <Text style={styles.hint}>We picked {suggestion.intake_year} from your email. Change it if it is wrong.</Text>
                ) : null}
              </View>

              <FormMessage message={error} />
              <Button
                label={chosen ? 'Join this batch' : 'Join batch'}
                loading={joining}
                onPress={() => join(chosen?.id ?? null, chosen ? null : query, year)}
              />
            </View>
          ) : null}

          {mode === 'done' && joined ? (
            <View style={styles.stack}>
              <Text style={styles.title}>You are in your batch</Text>
              <View style={styles.batchCard}>
                <View style={styles.batchIcon}>
                  <UsersThreeIcon size={26} weight="bold" color={brand.ink} />
                </View>
                {/* The full batch name carries the university, so groups with the same programme at
                    other universities never look alike. */}
                <Text style={styles.batchName}>{joined.name}</Text>
                <Text style={styles.batchMeta}>{members(joined.members)}</Text>
              </View>
              <Text style={styles.lead}>
                Your batch group chat opens with Chats. Need to change your batch? Contact the Uni Era team.
              </Text>
              <Button label="Done" onPress={() => router.back()} />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    minHeight: 56,
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  barTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  content: { padding: space.xl, paddingBottom: space.xxxl },
  stack: { gap: space.lg, width: '100%', maxWidth: 520, alignSelf: 'center' },
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: t.text, letterSpacing: -0.3 },
  lead: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: t.textMuted },
  batchCard: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.xl, gap: space.xs },
  batchIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: brand.red,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  batchName: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: t.text },
  batchMeta: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: t.textMuted },
  matches: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.xs },
  match: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  matchActive: { borderColor: t.focus, backgroundColor: t.background },
  matchName: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 16, color: t.text },
  matchMeta: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.textMuted },
  yearBlock: { gap: space.sm },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  years: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  year: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + 2,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: t.border,
    backgroundColor: t.surface,
  },
  // Selected year: red with Ink text (brand rule: text on red is Ink).
  yearActive: { backgroundColor: brand.red, borderColor: brand.red },
  yearText: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  yearTextActive: { color: brand.ink },
  hint: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
}));
