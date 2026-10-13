import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, View } from 'react-native';
import { FilePdfIcon } from 'phosphor-react-native/src/icons/FilePdf';
import { MagnifyingGlassPlusIcon } from 'phosphor-react-native/src/icons/MagnifyingGlassPlus';
import { WarningIcon } from 'phosphor-react-native/src/icons/Warning';

import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { KeyboardFrame, KeyboardScroll } from '@/components/ui/keyboard';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import {
  forgetLetters,
  letterLink,
  loadLiveUniversities,
  openLetterPdf,
  reviewFresher,
  searchProgrammes,
  type Institution,
  type Programme,
} from '@/lib/freshers';
import { useHomeData } from '@/providers/home-provider';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// What the admin asks for when the letter will not do. The fresher sees it and uploads again.
const REUPLOAD = [
  'The photo is blurry. Take it again in good light, with the whole letter in the frame.',
  'Part of the letter is cut off. Include the whole page.',
  'This is not the UGC selection letter. Upload the letter UGC sent you.',
];
const REJECT = ['This letter belongs to someone else.', 'This letter looks edited.'];

// National admins: read one fresher's letter and place them in their batch, ask for a clearer
// letter, or turn them down. The letter link lasts 5 minutes; a PDF opened here is deleted from the
// phone when the screen closes.
export default function FresherReview() {
  const theme = useTheme();
  const styles = useStyles();
  const { refresh: refreshHome } = useHomeData();
  const params = useLocalSearchParams<{ id: string; email?: string; mime?: string; same?: string }>();
  const id = params.id;
  const same = Number(params.same ?? 0);
  const [letter, setLetter] = useState<{ url: string; mime: string } | null>(null);
  const [ratio, setRatio] = useState(0.7);
  const [universities, setUniversities] = useState<Institution[]>([]);
  const [institution, setInstitution] = useState<Institution | null>(null);
  const [query, setQuery] = useState('');
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [programme, setProgramme] = useState<Programme | null>(null);
  const year = new Date().getFullYear();
  const [intake, setIntake] = useState(year);
  const [letterNumber, setLetterNumber] = useState('');
  const [mode, setMode] = useState<'approve' | 'reupload' | 'reject'>('approve');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    letterLink(id).then((r) => ('error' in r ? setError(r.error) : setLetter(r)));
    loadLiveUniversities().then((r) => setUniversities(r.data ?? []));
    return () => forgetLetters();
  }, [id]);

  useEffect(() => {
    if (!institution) return;
    let live = true;
    const timer = setTimeout(() => {
      searchProgrammes(institution.id, query).then((r) => live && setProgrammes(r.data ?? []));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [institution, query]);

  async function decide() {
    setError(null);
    if (mode === 'approve') {
      if (!institution) return setError('Choose the university on the letter.');
      if (!programme && query.trim().length < 2) return setError('Choose or type the degree programme.');
    } else if (reason.trim().length < 3) {
      return setError(mode === 'reupload' ? 'Say what to fix.' : 'Give a reason.');
    }
    setSaving(true);
    const r =
      mode === 'approve'
        ? await reviewFresher(id, {
            decision: 'approved',
            institutionId: institution!.id,
            programmeId: programme?.id ?? null,
            programmeName: programme ? null : query.trim(),
            intakeYear: intake,
            letterNumber,
          })
        : await reviewFresher(id, { decision: mode === 'reupload' ? 'reupload' : 'rejected', reason: reason.trim() });
    setSaving(false);
    if (r.error) return setError(r.error);
    refreshHome();
    router.back();
  }

  async function openPdf() {
    // Links last 5 minutes: get a fresh one each time.
    const link = await letterLink(id);
    if ('error' in link) return setError(link.error);
    const failed = await openLetterPdf(link.url, id);
    if (failed) setError(failed);
  }

  return (
    <Screen style={styles.screen} edges={['top']}>
      <BackHeader title="Fresher" />
      <KeyboardFrame style={styles.flex}>
        <KeyboardScroll contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.email}>{params.email}</Text>
          {same > 0 ? (
            <View style={styles.flag}>
              <WarningIcon size={16} weight="fill" color={theme.dangerText} />
              <Text style={styles.flagText}>
                {same} other {same === 1 ? 'account' : 'accounts'} uploaded this very same file. Check carefully.
              </Text>
            </View>
          ) : null}

          {!letter ? (
            <View style={[styles.letterBox, styles.center]}>{error ? null : <ActivityIndicator color={theme.accentText} />}</View>
          ) : letter.mime === 'application/pdf' ? (
            <PressableScale onPress={openPdf} accessibilityRole="button" style={[styles.letterBox, styles.center, styles.pdf]}>
              <FilePdfIcon size={40} weight="bold" color={theme.onAccentTint} />
              <Text style={styles.pdfText}>Open the letter</Text>
            </PressableScale>
          ) : (
            <View>
              <Image
                source={{ uri: letter.url }}
                cachePolicy="none"
                contentFit="contain"
                onLoad={(e) => setRatio(e.source.width / e.source.height)}
                style={[styles.letterImage, { aspectRatio: ratio }]}
                accessibilityLabel="Selection letter"
              />
              <PressableScale
                onPress={() => Linking.openURL(letter.url)}
                accessibilityRole="button"
                accessibilityLabel="Open full size to zoom"
                style={styles.zoom}>
                <MagnifyingGlassPlusIcon size={18} weight="bold" color={theme.text} />
                <Text style={styles.zoomText}>Zoom</Text>
              </PressableScale>
            </View>
          )}

          <View style={styles.modes} accessibilityRole="tablist">
            {(
              [
                ['approve', 'Approve'],
                ['reupload', 'Ask again'],
                ['reject', 'Turn down'],
              ] as const
            ).map(([key, label]) => (
              <PressableScale
                key={key}
                onPress={() => {
                  setMode(key);
                  setReason('');
                  setError(null);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === key }}
                style={[styles.chip, mode === key && styles.chipOn]}>
                <Text style={[styles.chipText, mode === key && styles.chipTextOn]}>{label}</Text>
              </PressableScale>
            ))}
          </View>

          {mode === 'approve' ? (
            <>
              <Text style={styles.heading}>University</Text>
              <View style={styles.chips}>
                {universities.map((u) => (
                  <PressableScale
                    key={u.id}
                    onPress={() => {
                      setInstitution(u);
                      setProgramme(null);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: institution?.id === u.id }}
                    style={[styles.chip, institution?.id === u.id && styles.chipOn]}>
                    <Text style={[styles.chipText, institution?.id === u.id && styles.chipTextOn]}>{u.short_name ?? u.name}</Text>
                  </PressableScale>
                ))}
              </View>

              {institution ? (
                <>
                  <Text style={styles.heading}>Degree programme</Text>
                  <TextField
                    label="Programme"
                    value={programme ? programme.name : query}
                    onChangeText={(v) => {
                      setProgramme(null);
                      setQuery(v);
                    }}
                    hint="As on the letter. Pick a match below, or keep what you typed to add it."
                  />
                  {!programme && programmes.length > 0 ? (
                    <View style={styles.chips}>
                      {programmes.map((p) => (
                        <PressableScale key={p.id} onPress={() => setProgramme(p)} accessibilityRole="button" style={styles.chip}>
                          <Text style={styles.chipText}>{p.name}</Text>
                        </PressableScale>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}

              <Text style={styles.heading}>Intake year</Text>
              <View style={styles.chips}>
                {[year - 1, year, year + 1].map((y) => (
                  <PressableScale
                    key={y}
                    onPress={() => setIntake(y)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: intake === y }}
                    style={[styles.chip, intake === y && styles.chipOn]}>
                    <Text style={[styles.chipText, intake === y && styles.chipTextOn]}>{y}</Text>
                  </PressableScale>
                ))}
              </View>

              <TextField
                label="Letter or A/L index number (optional)"
                value={letterNumber}
                onChangeText={setLetterNumber}
                hint="Kept only as a code, so the same letter cannot make a second account."
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </>
          ) : (
            <>
              <View style={styles.chips}>
                {(mode === 'reupload' ? REUPLOAD : REJECT).map((r) => (
                  <PressableScale
                    key={r}
                    onPress={() => setReason(r)}
                    accessibilityRole="button"
                    style={[styles.reasonChip, reason === r && styles.chipOn]}>
                    <Text style={[styles.chipText, reason === r && styles.chipTextOn]}>{r}</Text>
                  </PressableScale>
                ))}
              </View>
              <TextField
                label={mode === 'reupload' ? 'What to fix' : 'Reason'}
                value={reason}
                onChangeText={setReason}
                hint="The fresher sees this."
                maxLength={300}
                multiline
              />
            </>
          )}

          <FormMessage message={error} />
          <Button
            label={mode === 'approve' ? 'Approve and add to batch' : mode === 'reupload' ? 'Ask for a new letter' : 'Turn down'}
            loading={saving}
            onPress={decide}
          />
        </KeyboardScroll>
      </KeyboardFrame>
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  flex: { flex: 1 },
  content: { padding: space.xl, paddingTop: space.sm, gap: space.md, width: '100%', maxWidth: 640, alignSelf: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  email: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  flag: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: t.errorBg,
    borderRadius: radius.md,
    padding: space.md,
  },
  flagText: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 20, color: t.dangerText },
  letterBox: { height: 220, borderRadius: radius.lg, backgroundColor: t.surface },
  pdf: { gap: space.sm, backgroundColor: t.accentTint },
  pdfText: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.onAccentTint },
  letterImage: { width: '100%', borderRadius: radius.lg, backgroundColor: t.surface },
  zoom: {
    position: 'absolute',
    right: space.sm,
    bottom: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: t.background,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
  },
  zoomText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  modes: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  heading: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted, marginTop: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: t.surface },
  reasonChip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: t.surface },
  chipOn: { backgroundColor: t.focus },
  chipText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: t.text },
  chipTextOn: { color: t.background },
}));
