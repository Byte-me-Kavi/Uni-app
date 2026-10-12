import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { FileArrowUpIcon } from 'phosphor-react-native/src/icons/FileArrowUp';

import { ModuleChip } from '@/components/resources/module-chip';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { formatBytes } from '@/lib/chat/attachments';
import { refreshOverview, type Category } from '@/lib/library';
import { useMyModules } from '@/lib/modules';
import {
  pickShareable,
  publishFromChat,
  SHARED_CATEGORIES,
  uploadShared,
  verdictText,
  type PickedShare,
  type SharedCategory,
} from '@/lib/shared';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

const stripExtension = (name: string) => name.replace(/\.[A-Za-z0-9]{2,5}$/, '');
const asShared = (c: string | undefined): SharedCategory =>
  SHARED_CATEGORIES.some((x) => x.key === c) ? (c as SharedCategory) : 'notes';

// Share with your university: a file from a chat (message param) or one picked from the phone. The
// file is checked before anyone sees it; the answer shows here.
export default function Share() {
  const theme = useTheme();
  const styles = useStyles();
  const params = useLocalSearchParams<{ message?: string; module?: string; title?: string; category?: Category }>();
  const fromChat = !!params.message;
  const { data } = useMyModules();
  const modules = data?.batch ? [...data.current, ...data.past.flatMap((p) => p.modules)].filter((m) => !m.pending) : [];

  const [years] = useState(() => Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i));
  const [moduleId, setModuleId] = useState<number | null>(params.module ? Number(params.module) : null);
  const [category, setCategory] = useState<SharedCategory>(asShared(params.category));
  const [title, setTitle] = useState(params.title ? stripExtension(params.title) : '');
  const [year, setYear] = useState<number | null>(null);
  const [scope, setScope] = useState<'university' | 'national'>('university');
  const [file, setFile] = useState<PickedShare | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function pick() {
    setError(null);
    const picked = await pickShareable();
    if (!picked) return;
    if ('error' in picked) return setError(picked.error);
    setFile(picked.ok);
    if (!title) setTitle(stripExtension(picked.ok.name));
  }

  async function share() {
    if (!moduleId) return setError('Choose the module.');
    if (title.trim().length < 3) return setError('Give it a name.');
    if (!fromChat && !file) return setError('Choose a file.');
    setBusy(true);
    setError(null);
    const input = { moduleId, category, title: title.trim(), paperYear: category === 'past_papers' ? year : null, scope };
    const { verdict, error: e } = fromChat
      ? await publishFromChat(params.message!, input)
      : await uploadShared(file!, input, setProgress);
    setBusy(false);
    setProgress(null);
    if (e) return setError(e);
    setResult(verdictText(verdict));
    refreshOverview();
  }

  if (result) {
    return (
      <Screen style={styles.screen}>
        <BackHeader title="Share" />
        <View style={styles.done}>
          <Text style={styles.doneTitle}>{result}</Text>
          <Button label="Done" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen style={styles.screen}>
      <BackHeader title="Share with your university" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.stack}>
            <Text style={styles.lead}>
              Share your own work, past papers and notes you may pass on; never assignments for sale or exam answers.
              Each file is checked before it shows, and a file already shared is not shared twice.
            </Text>

            {!fromChat ? (
              <PressableScale onPress={pick} accessibilityRole="button" scale={0.985} style={styles.pick}>
                <FileArrowUpIcon size={26} weight="bold" color={theme.text} />
                <View style={styles.pickCopy}>
                  <Text style={styles.pickTitle} numberOfLines={2}>
                    {file ? file.name : 'Choose a file'}
                  </Text>
                  <Text style={styles.muted}>{file ? formatBytes(file.size) : 'PDF, Word, PowerPoint or a photo, up to 25 MB'}</Text>
                </View>
              </PressableScale>
            ) : null}

            <Group label="Module">
              <View style={styles.chips}>
                {modules.map((m) => (
                  <ModuleChip key={m.id} id={m.id} code={m.code} name={m.name} active={m.id === moduleId} onPress={() => setModuleId(m.id)} />
                ))}
              </View>
            </Group>
            <Group label="What is it">
              <View style={styles.chips}>
                {SHARED_CATEGORIES.map((c) => (
                  <Chip key={c.key} label={c.label} active={c.key === category} onPress={() => setCategory(c.key)} />
                ))}
              </View>
            </Group>
            {category === 'past_papers' ? (
              <Group label="Year of the paper">
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                  {years.map((y) => (
                    <Chip key={y} label={String(y)} active={y === year} onPress={() => setYear(y === year ? null : y)} />
                  ))}
                </ScrollView>
              </Group>
            ) : null}
            <TextField label="Name" value={title} onChangeText={setTitle} placeholder="e.g. CS2012 Past Paper 2023" maxLength={160} />
            <Group label="Who can see it">
              <View style={styles.chips}>
                <Chip label="My university" active={scope === 'university'} onPress={() => setScope('university')} />
                <Chip label="All universities" active={scope === 'national'} onPress={() => setScope('national')} />
              </View>
              <Text style={styles.muted}>
                {scope === 'national'
                  ? 'Students at every university taking the same subject can find it, with your name and university.'
                  : 'Only students at your university can find it.'}
              </Text>
            </Group>

            <FormMessage message={error} />
            {progress !== null ? <Text style={styles.muted}>Uploading {Math.round(progress * 100)}%</Text> : null}
            <Button label={busy && progress === null ? 'Checking the file…' : 'Share'} loading={busy} onPress={share} />
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
  lead: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: t.textMuted },
  muted: { fontFamily: fonts.body, fontSize: 14, color: t.textMuted },
  pick: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg },
  pickCopy: { flex: 1, gap: 2 },
  pickTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  group: { gap: space.sm },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
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
  chipActive: { backgroundColor: t.accent, borderColor: t.accent },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  chipTextActive: { color: t.onAccent },
  done: { flex: 1, padding: space.xl, gap: space.xl, justifyContent: 'center', width: '100%', maxWidth: 560, alignSelf: 'center' },
  doneTitle: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: t.text },
}));
