import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { KuppiCard } from '@/components/resources/kuppi-card';
import { KuppiRequests } from '@/components/resources/kuppi-requests';
import { SharedRow } from '@/components/resources/shared-row';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { TextField } from '@/components/ui/text-field';
import { listKuppi, type Kuppi } from '@/lib/kuppi';
import {
  exploreFiles,
  loadModuleSubject,
  setModuleSubject,
  SHARED_CATEGORIES,
  type ModuleSubject,
  type SharedCategory,
  type SharedFile,
} from '@/lib/shared';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// What students shared for one module, by kind, newest first: at the student's university, or (for
// the same national subject) at other universities when the uploader shared with everyone.
export function SharedForModule({ moduleId, code, initialCategory = null }: { moduleId: number; code: string; initialCategory?: SharedCategory | null }) {
  const theme = useTheme();
  const styles = useStyles();
  const [category, setCategory] = useState<SharedCategory | null>(initialCategory);
  const [national, setNational] = useState(false);
  const [files, setFiles] = useState<SharedFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState<ModuleSubject | null>(null);
  const [editing, setEditing] = useState(false);
  const [subjectName, setSubjectName] = useState('');
  const [subjectError, setSubjectError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadModuleSubject(moduleId).then((s) => live && setSubject(s));
    return () => {
      live = false;
    };
  }, [moduleId]);

  useEffect(() => {
    let live = true;
    exploreFiles({ moduleId, category, national }).then((r) => {
      if (!live) return;
      setFiles(r.files);
      setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [moduleId, category, national]);

  async function saveSubject() {
    setSubjectError(null);
    const { subject: next, error: e } = await setModuleSubject(moduleId, subjectName.trim());
    if (e) return setSubjectError(e);
    setSubject(next);
    setEditing(false);
  }

  const others = subject?.national_files ?? 0;

  return (
    <View style={styles.gap}>
      {subject?.subject ? (
        <View style={styles.subject}>
          <Text style={styles.muted}>
            Subject: <Text style={styles.subjectName}>{subject.subject.name}</Text>
            {subject.universities && subject.universities > 1 ? ` · taught at ${subject.universities} universities` : ''}
          </Text>
          {subject.can_edit && !editing ? (
            <PressableScale
              onPress={() => {
                setSubjectName(subject.subject!.name);
                setEditing(true);
              }}
              accessibilityRole="button"
              hitSlop={8}>
              <Text style={styles.link}>Change</Text>
            </PressableScale>
          ) : null}
        </View>
      ) : null}
      {editing ? (
        <View style={styles.gap}>
          <TextField
            label="National subject"
            value={subjectName}
            onChangeText={setSubjectName}
            hint="The same subject at every university, e.g. Data Structures and Algorithms. Students elsewhere find files shared with everyone through it."
          />
          <FormMessage message={subjectError} />
          <View style={styles.row}>
            <PressableScale onPress={saveSubject} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.link}>Save</Text>
            </PressableScale>
            <PressableScale onPress={() => setEditing(false)} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.muted}>Cancel</Text>
            </PressableScale>
          </View>
        </View>
      ) : null}

      <View style={styles.chips}>
        <Chip label="Your university" active={!national} onPress={() => setNational(false)} />
        <Chip label={`Other universities${others ? ` (${others})` : ''}`} active={national} onPress={() => setNational(true)} />
      </View>
      <View style={styles.chips}>
        <Chip label="All" active={category === null} onPress={() => setCategory(null)} />
        {SHARED_CATEGORIES.map((c) => (
          <Chip key={c.key} label={c.label} active={category === c.key} onPress={() => setCategory(c.key)} />
        ))}
      </View>
      {files === null ? (
        error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} style={styles.spinner} />
      ) : files.length > 0 ? (
        <View style={styles.card}>
          {files.map((f) => (
            <SharedRow key={f.id} file={f} onRemoved={(id) => setFiles((list) => list?.filter((x) => x.id !== id) ?? list)} />
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{national ? 'Nothing from other universities yet' : `Nothing shared for ${code} yet`}</Text>
          <Text style={styles.muted}>
            {national
              ? `Files students elsewhere share with all universities for ${subject?.subject?.name ?? 'this subject'} show here.`
              : 'Past papers and notes shared by students at your university show here.'}
          </Text>
        </View>
      )}
      <Button label={`Share a file to ${code}`} variant="quiet" onPress={() => router.push({ pathname: '/share', params: { module: String(moduleId) } })} />
    </View>
  );
}

// Upcoming kuppi for one module, and hosting one.
export function KuppiForModule({ moduleId, code }: { moduleId: number; code: string }) {
  const theme = useTheme();
  const styles = useStyles();
  const [list, setList] = useState<Kuppi[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listKuppi('module', moduleId).then((r) => {
      if (!live) return;
      setList(r.list);
      setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [moduleId]);

  return (
    <View style={styles.gap}>
      {list === null ? (
        error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} style={styles.spinner} />
      ) : list.length > 0 ? (
        list.map((k) => <KuppiCard key={k.id} kuppi={k} />)
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No kuppi for {code} coming up</Text>
          <Text style={styles.muted}>Know a topic well? Host one: your batchmates RSVP and get the link 15 minutes before.</Text>
        </View>
      )}
      <Button label={`Host a kuppi for ${code}`} onPress={() => router.push({ pathname: '/kuppi/new', params: { module: String(moduleId) } })} />
      <KuppiRequests scope="module" moduleId={moduleId} />
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
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
  gap: { gap: space.md },
  spinner: { paddingVertical: space.xl },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: t.border,
    backgroundColor: t.surface,
  },
  // Selected: the accent with Ink text (brand rule).
  chipActive: { backgroundColor: brand.accent, borderColor: brand.accent },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.text },
  chipTextActive: { color: brand.ink },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, paddingLeft: space.md, paddingRight: space.xs, paddingVertical: space.xs },
  empty: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.xl, gap: space.sm },
  emptyTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  muted: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.textMuted },
  subject: { flexDirection: 'row', alignItems: 'center', gap: space.md, justifyContent: 'space-between' },
  subjectName: { fontFamily: fonts.bodyBold, color: t.text },
  link: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.accentText },
  row: { flexDirection: 'row', gap: space.xl },
}));
