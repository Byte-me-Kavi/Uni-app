import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Text, View } from 'react-native';

import { StudentPicker } from '@/components/chat/student-picker';
import { ActionSheet } from '@/components/ui/action-sheet';
import { Avatar } from '@/components/ui/avatar';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { KeyboardFrame, KeyboardScroll } from '@/components/ui/keyboard';
import { appointMerchLead, loadMerchLeads, removeMerchLead, type MerchLead, type MerchLeads } from '@/lib/shop';
import type { PersonResult } from '@/lib/use-people-search';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// Students at your own university (merch leads publish for clubs there).
const atMyUniversity = (p: PersonResult) => p.relation !== null;

// Merch leads: students a batch rep lets publish merch for a club or society (the Rotaract Club's
// hoodie, the Media Unit's T-shirt). Reps choose them here and can end the ones they chose; a merch
// lead sees their own role and can step down.
//
// Choosing one: pick the student, then name the club in a card on this screen (not a second sheet
// over the picker, which stalled while the picker and its keyboard were still closing).
export default function MerchLeadsScreen() {
  const theme = useTheme();
  const styles = useStyles();
  // add: opened from Sell → Add a merch lead, so the picker opens straight away.
  const params = useLocalSearchParams<{ add?: string }>();
  const [data, setData] = useState<MerchLeads | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [person, setPerson] = useState<PersonResult | null>(null);
  const [club, setClub] = useState('');
  const [saving, setSaving] = useState(false);
  const [ending, setEnding] = useState<MerchLead | null>(null);
  const opened = useRef(false);

  useEffect(() => {
    let live = true;
    loadMerchLeads().then((r) => {
      if (!live) return;
      if (r.data) {
        setData(r.data);
        if (params.add === '1' && r.data.can_appoint && !opened.current) {
          opened.current = true;
          setPicking(true);
        }
      }
      setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [params.add]);

  const clubs = [...new Set((data?.leads ?? []).map((l) => l.club))];

  function pick(p: PersonResult) {
    Keyboard.dismiss();
    setPicking(false);
    setError(null);
    setNote(null);
    setPerson(p);
  }

  async function appoint() {
    if (!person) return;
    setSaving(true);
    setError(null);
    const r = await appointMerchLead(person.user_id, club.trim());
    setSaving(false);
    if (r.error) return setError(r.error);
    setData(r.data);
    setNote(`${person.full_name.split(' ')[0]} can now publish merch for ${club.trim()}.`);
    setPerson(null);
    setClub('');
    Keyboard.dismiss();
  }

  const end = useCallback(async (lead: MerchLead) => {
    setError(null);
    const r = await removeMerchLead(lead.user.id);
    if (r.error) return setError(r.error);
    setData(r.data);
    setNote(`${lead.user.name.split(' ')[0]} is no longer a merch lead. What they published stays up.`);
  }, []);

  if (!data) {
    return (
      <Screen style={styles.screen}>
        <BackHeader title="Merch leads" />
        <View style={styles.center}>
          {error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} />}
        </View>
      </Screen>
    );
  }

  return (
    <Screen style={styles.screen}>
      <BackHeader title="Merch leads" />
      <KeyboardFrame style={styles.flex}>
        <KeyboardScroll style={styles.list} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.stack}>
            <Text style={styles.intro}>
              Clubs and societies sell merch too. A merch lead publishes it for their club, takes the pre-orders and checks the
              slips, like a rep does for the batch.
            </Text>

            {data.me ? (
              <View style={styles.me}>
                <Text style={styles.meTitle}>You are the merch lead of {data.me.club}</Text>
                <Text style={styles.meBody}>Chosen by {data.me.appointed_by ?? 'a rep'}. Publish from Sell in the Shop.</Text>
                <Button label="Step down" variant="quiet" onPress={() => setEnding(data.me)} />
              </View>
            ) : null}

            <FormMessage message={note} tone="info" />

            {data.can_appoint ? (
              person ? (
                <View style={styles.form}>
                  <View style={styles.formHead}>
                    <Avatar name={person.full_name} path={person.avatar_path} />
                    <View style={styles.copy}>
                      <Text style={styles.name} numberOfLines={1}>
                        Make {person.full_name} a merch lead
                      </Text>
                      <Text style={styles.muted} numberOfLines={1}>
                        {[person.programme, person.intake_year].filter(Boolean).join(' ') || person.institution}
                      </Text>
                    </View>
                  </View>
                  <TextField
                    label="Club or society"
                    value={club}
                    onChangeText={setClub}
                    placeholder="e.g. Rotaract Club"
                    maxLength={60}
                    returnKeyType="done"
                    onSubmitEditing={() => club.trim().length >= 2 && appoint()}
                    hint="Their merch shows as from this club. Merch leads of the same club share its orders."
                  />
                  {clubs.length > 0 ? (
                    <View style={styles.suggestions}>
                      {clubs.slice(0, 6).map((c) => (
                        <PressableScale
                          key={c}
                          onPress={() => setClub(c)}
                          accessibilityRole="button"
                          accessibilityLabel={`Use ${c}`}
                          style={[styles.suggestion, club === c && styles.suggestionOn]}>
                          <Text style={[styles.suggestionText, club === c && styles.suggestionTextOn]}>{c}</Text>
                        </PressableScale>
                      ))}
                    </View>
                  ) : null}
                  <FormMessage message={error} />
                  <Button label="Make merch lead" disabled={club.trim().length < 2} loading={saving} onPress={appoint} />
                  <Button
                    label="Choose someone else"
                    variant="quiet"
                    onPress={() => {
                      setPerson(null);
                      setError(null);
                      setPicking(true);
                    }}
                  />
                </View>
              ) : (
                <>
                  <Button label="Add a merch lead" onPress={() => setPicking(true)} />
                  <FormMessage message={error} />
                </>
              )
            ) : (
              <FormMessage message={error} />
            )}

            {data.can_appoint ? (
              <View style={styles.section}>
                <Text style={styles.label}>Merch leads at your university</Text>
                {data.leads.length === 0 ? (
                  <Text style={styles.empty}>None yet. Add the person who runs the merch of a club.</Text>
                ) : (
                  data.leads.map((item) => (
                    <View key={item.user.id} style={styles.row}>
                      <Avatar name={item.user.name} path={item.user.avatar_path} />
                      <View style={styles.copy}>
                        <Text style={styles.name} numberOfLines={1}>
                          {item.user.name}
                        </Text>
                        <Text style={styles.club} numberOfLines={1}>
                          {item.club}
                        </Text>
                        <Text style={styles.muted} numberOfLines={1}>
                          {item.mine ? 'Chosen by you' : `Chosen by ${item.appointed_by ?? 'a rep'}`}
                        </Text>
                      </View>
                      {item.mine ? (
                        <PressableScale
                          onPress={() => setEnding(item)}
                          accessibilityRole="button"
                          accessibilityLabel={`End ${item.user.name} as merch lead`}
                          style={styles.end}>
                          <Text style={styles.endText}>End</Text>
                        </PressableScale>
                      ) : null}
                    </View>
                  ))
                )}
              </View>
            ) : null}
          </View>
        </KeyboardScroll>
      </KeyboardFrame>

      <StudentPicker
        visible={picking}
        title="Choose a merch lead"
        only={atMyUniversity}
        onClose={() => setPicking(false)}
        onPick={pick}
      />
      <ActionSheet
        visible={!!ending}
        title={
          ending?.user.id === data.me?.user.id ? 'Step down as merch lead?' : `End ${ending?.user.name ?? ''} as merch lead?`
        }
        message="They can no longer publish merch for the club. What they already published stays up, and they still run its orders."
        actions={
          ending
            ? [
                {
                  label: ending.user.id === data.me?.user.id ? 'Step down' : 'End',
                  destructive: true,
                  onPress: () => end(ending),
                },
              ]
            : []
        }
        onClose={() => setEnding(null)}
      />
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  list: { flex: 1 },
  content: { padding: space.xl, paddingTop: space.sm, paddingBottom: space.xxxl },
  stack: { gap: space.lg, width: '100%', maxWidth: 560, alignSelf: 'center' },
  intro: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: t.textMuted },
  section: { gap: space.sm },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  me: { backgroundColor: t.accentTint, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  meTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.onAccentTint },
  meBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.onAccentTint },
  form: { borderWidth: 1.5, borderColor: t.accent, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  formHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.lg,
    padding: space.md,
  },
  copy: { flex: 1, gap: 1 },
  name: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  club: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: t.accentText },
  muted: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  end: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: 40,
    justifyContent: 'center',
  },
  endText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.dangerText },
  empty: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  suggestion: { backgroundColor: t.surface, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.sm },
  suggestionOn: { backgroundColor: t.accent },
  suggestionText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  suggestionTextOn: { color: t.onAccent },
}));
