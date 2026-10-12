import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { createKuppi } from '@/lib/kuppi';
import { useMyModules } from '@/lib/modules';
import { brand, createThemedStyles, fonts, radius, space } from '@/theme/tokens';

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6 am to 10 pm
const MINUTES = [0, 15, 30, 45];
const LENGTHS = [
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 90, label: '1.5 hours' },
  { minutes: 120, label: '2 hours' },
  { minutes: 180, label: '3 hours' },
];
const CAPACITIES = [10, 20, 40, 100, 300];

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`;

// Host a kuppi in under a minute: module, topic, day and time from chips, a Zoom / Meet / Teams link
// or a venue, and how many can come.
export default function NewKuppi() {
  const styles = useStyles();
  // request and title: hosting a kuppi that answers a student request. national: the request was asked
  // at another university, so the kuppi is online and open to all universities.
  const params = useLocalSearchParams<{ module?: string; request?: string; title?: string; national?: string }>();
  const forAll = params.national === '1';
  const { data } = useMyModules();
  const modules = data?.batch ? data.current.filter((m) => !m.pending) : [];

  const [days] = useState(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Array.from({ length: 14 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
  });
  const [moduleId, setModuleId] = useState<number | null>(params.module ? Number(params.module) : null);
  const [title, setTitle] = useState(params.title ?? '');
  const [description, setDescription] = useState('');
  const [day, setDay] = useState(1);
  const [hour, setHour] = useState(19);
  const [minute, setMinute] = useState(0);
  const [length, setLength] = useState(60);
  const [mode, setMode] = useState<'online' | 'in_person'>('online');
  const [link, setLink] = useState('');
  const [venue, setVenue] = useState('');
  const [capacity, setCapacity] = useState(40);
  const [scope, setScope] = useState<'university' | 'national'>(forAll ? 'national' : 'university');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!moduleId) return setError('Choose the module.');
    const startsAt = new Date(days[day]);
    startsAt.setHours(hour, minute, 0, 0);
    setSaving(true);
    setError(null);
    const { kuppi, error: e } = await createKuppi({
      moduleId,
      title: title.trim(),
      description: description.trim() || undefined,
      startsAt,
      minutes: length,
      mode,
      capacity,
      meetingUrl: mode === 'online' ? link.trim() : undefined,
      venue: mode === 'in_person' ? venue.trim() : undefined,
      requestId: params.request,
      scope: mode === 'online' ? scope : 'university',
    });
    setSaving(false);
    if (e || !kuppi) return setError(e);
    router.replace({ pathname: '/kuppi/[id]', params: { id: kuppi.id } });
  }

  return (
    <Screen style={styles.screen}>
      <BackHeader title="Host a kuppi" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.stack}>
            {params.request ? (
              <Text style={styles.hint}>
                {forAll
                  ? 'Answering a request from another university: your kuppi is online and open to students on this subject at every university.'
                  : 'Answering a request: everyone who asked for it sees your kuppi.'}
              </Text>
            ) : null}
            <Group label="Module">
              {modules.length === 0 ? <Text style={styles.hint}>Set up your modules in Resources first.</Text> : null}
              <View style={styles.chips}>
                {modules.map((m) => (
                  <Chip key={m.id} label={m.code} a11y={`${m.code}, ${m.name}`} active={m.id === moduleId} onPress={() => setModuleId(m.id)} />
                ))}
              </View>
            </Group>

            <TextField label="Topic" value={title} onChangeText={setTitle} placeholder="e.g. AVL trees and rotations" maxLength={120} />
            <TextField
              label="What you will cover (optional)"
              value={description}
              onChangeText={setDescription}
              placeholder="Bring last year's paper; we will go through Q3 and Q4."
              multiline
              maxLength={1000}
            />

            <Group label="Day">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                {days.map((d, i) => (
                  <Chip
                    key={d.toISOString()}
                    label={i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
                    active={i === day}
                    onPress={() => setDay(i)}
                  />
                ))}
              </ScrollView>
            </Group>
            <Group label="Starts at">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                {HOURS.map((h) => (
                  <Chip key={h} label={hourLabel(h)} active={h === hour} onPress={() => setHour(h)} />
                ))}
              </ScrollView>
              <View style={styles.chips}>
                {MINUTES.map((m) => (
                  <Chip key={m} label={`:${String(m).padStart(2, '0')}`} active={m === minute} onPress={() => setMinute(m)} />
                ))}
              </View>
            </Group>
            <Group label="Length">
              <View style={styles.chips}>
                {LENGTHS.map((l) => (
                  <Chip key={l.minutes} label={l.label} active={l.minutes === length} onPress={() => setLength(l.minutes)} />
                ))}
              </View>
            </Group>

            <Group label="Where">
              <View style={styles.chips}>
                <Chip label="Online" active={mode === 'online'} onPress={() => setMode('online')} />
                {!forAll ? <Chip label="In person" active={mode === 'in_person'} onPress={() => setMode('in_person')} /> : null}
              </View>
            </Group>
            {mode === 'online' && !forAll ? (
              <Group label="Who can join">
                <View style={styles.chips}>
                  <Chip label="My university" active={scope === 'university'} onPress={() => setScope('university')} />
                  <Chip label="All universities" active={scope === 'national'} onPress={() => setScope('national')} />
                </View>
                <Text style={styles.hint}>
                  {scope === 'national'
                    ? 'Students taking this subject at any university can find it and RSVP, and see your name and university.'
                    : 'Only students at your university can find it.'}
                </Text>
              </Group>
            ) : null}
            {mode === 'online' ? (
              <TextField
                label="Zoom, Google Meet or Teams link"
                value={link}
                onChangeText={setLink}
                placeholder="https://zoom.us/j/..."
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                hint="Only students who RSVP see it, from 15 minutes before the start. Turn on a waiting room or passcode, and use your university account: free Zoom stops after 40 minutes."
              />
            ) : (
              <TextField label="Venue" value={venue} onChangeText={setVenue} placeholder="e.g. Lab 3, Faculty of Science" maxLength={160} />
            )}

            <Group label="How many can come">
              <View style={styles.chips}>
                {CAPACITIES.map((c) => (
                  <Chip key={c} label={String(c)} active={c === capacity} onPress={() => setCapacity(c)} />
                ))}
              </View>
            </Group>

            <FormMessage message={error} />
            <Button label="Publish kuppi" loading={saving} onPress={create} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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

function Chip({ label, a11y, active, onPress }: { label: string; a11y?: string; active: boolean; onPress: () => void }) {
  const styles = useStyles();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={a11y ?? label}
      style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </PressableScale>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  flex: { flex: 1 },
  content: { padding: space.xl, paddingBottom: space.xxxl },
  stack: { gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  group: { gap: space.sm },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  hint: { fontFamily: fonts.body, fontSize: 14, color: t.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { gap: space.sm, paddingRight: space.xl },
  chip: {
    paddingHorizontal: space.md + 2,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: t.border,
    backgroundColor: t.surface,
  },
  // Selected: the accent with Ink text (brand rule).
  chipActive: { backgroundColor: brand.accent, borderColor: brand.accent },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  chipTextActive: { color: brand.ink },
}));
