import { router } from 'expo-router';
import { useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { KeyboardFrame, KeyboardScroll } from '@/components/ui/keyboard';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { ago } from '@/lib/feed';
import { KIND_LABEL, openedReport, REMOVABLE, snapshotText, takeAction, type ActionKind } from '@/lib/moderation';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

const CHOICES: { action: ActionKind; label: string; detail: string }[] = [
  { action: 'dismiss', label: 'Dismiss', detail: 'Not against the guidelines. Hidden posts come back.' },
  { action: 'remove_content', label: 'Remove', detail: 'Take it down. Counts as a strike.' },
  { action: 'warn', label: 'Warn', detail: 'A written warning. A strike.' },
  { action: 'mute', label: 'Mute', detail: 'No sending, posting or commenting for a while.' },
  { action: 'suspend', label: 'Suspend', detail: 'The account stops working for a while.' },
  { action: 'ban', label: 'Close account', detail: 'For the worst cases. They can appeal.' },
];

// Reasons the student sees, written once so moderators answer the same thing the same way.
const REASONS = [
  'Threatening or ragging other students is against the community guidelines.',
  'Harassing or bullying another student is against the community guidelines.',
  'Hate based on ethnicity, religion, caste, gender or sexuality is not allowed.',
  'Sharing leaked exam papers is not allowed.',
  'Scams and asking students for money are not allowed.',
  'Spam and repeated posts are not allowed.',
];

const MUTE_DAYS = [1, 3, 7, 30];
const SUSPEND_DAYS = [3, 7, 30, 90];

// One reported thing: the evidence as it was when reported, who it is about, and what to do.
export default function Report() {
  const theme = useTheme();
  const styles = useStyles();
  const [group] = useState(openedReport);
  const [action, setAction] = useState<ActionKind | null>(null);
  const [reason, setReason] = useState('');
  const [days, setDays] = useState<number | null>(null);
  const [remove, setRemove] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [suggest, setSuggest] = useState<number | null>(null);
  // The reports are closed once acted on; a follow-up suspension is about the student only.
  // Opened from a student's card, with no report: actions on the student only.
  const [acted, setActed] = useState(() => (openedReport()?.reports ?? 0) === 0);

  if (!group) {
    return (
      <Screen style={styles.screen}>
        <BackHeader title="Report" />
        <Text style={styles.empty}>Open a report from the list.</Text>
      </Screen>
    );
  }

  const text = snapshotText(group.target_kind, group.snapshot);
  const removable = REMOVABLE.has(group.target_kind);
  const choices = CHOICES.filter((c) => (c.action === 'remove_content' ? removable && !acted : true))
    .filter((c) => !(acted && c.action === 'dismiss'))
    .filter((c) => group.subject || c.action === 'dismiss' || c.action === 'remove_content');

  async function submit() {
    if (!action || !group) return;
    setError(null);
    if ((action === 'mute' || action === 'suspend') && !days) return setError('Choose how long.');
    setSaving(true);
    const r = await takeAction({
      action,
      userId: group.subject?.user_id,
      reason: action === 'dismiss' ? undefined : reason,
      days: days ?? undefined,
      targetKind: acted ? undefined : group.target_kind,
      targetId: acted ? undefined : group.target_id,
      remove: !acted && removable && remove && ['warn', 'mute', 'suspend', 'ban'].includes(action),
    });
    setSaving(false);
    if (r.error !== null) return setError(r.error);
    if (r.data.suggest_suspend && !acted) {
      setActed(true);
      setSuggest(r.data.strikes);
      return;
    }
    router.back();
  }

  return (
    <Screen style={styles.screen} edges={['top']}>
      <BackHeader title="Report" />
      <KeyboardFrame style={styles.flex}>
        <KeyboardScroll contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.tags}>
            {group.categories.map((c) => (
              <View key={c} style={[styles.tag, group.priority === 1 && styles.tagUrgent]}>
                <Text style={[styles.tagText, group.priority === 1 && styles.tagTextUrgent]}>{c}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.title}>
            {KIND_LABEL[group.target_kind] ?? group.target_kind}, {group.institution}
          </Text>
          {group.reports > 0 ? (
            <Text style={styles.meta}>
              {group.reports} {group.reports === 1 ? 'report' : 'reports'}, first {ago(group.first_at)}. Who reported is never
              shown.
            </Text>
          ) : null}

          {group.reports > 0 ? (
            <View style={styles.evidence}>
              <Text style={styles.label}>As it was when reported</Text>
              {text.context.length > 0 ? (
                <View style={styles.context}>
                  {text.context.map((c, i) => (
                    <Text key={i} style={styles.contextText} numberOfLines={3}>
                      {c}
                    </Text>
                  ))}
                </View>
              ) : null}
              <Text style={styles.evidenceText}>{text.main || 'No text (a photo or file).'}</Text>
            </View>
          ) : null}

          {group.details.length > 0 ? (
            <View style={styles.block}>
              <Text style={styles.label}>What reporters said</Text>
              {group.details.map((d, i) => (
                <Text key={i} style={styles.detail}>
                  “{d}”
                </Text>
              ))}
            </View>
          ) : null}

          {group.subject ? (
            <PressableScale
              onPress={() => router.push({ pathname: '/people/[id]', params: { id: group.subject!.user_id } })}
              accessibilityRole="button"
              style={styles.subject}>
              <Text style={styles.subjectName}>{group.subject.name}</Text>
              <Text style={styles.meta}>
                {group.subject.strikes === 0
                  ? 'No strikes in the last 90 days'
                  : `${group.subject.strikes} ${group.subject.strikes === 1 ? 'strike' : 'strikes'} in the last 90 days`}
                {group.subject.status === 'suspended' ? '. Suspended now' : ''}
              </Text>
            </PressableScale>
          ) : null}

          {suggest !== null ? (
            <View style={styles.suggest}>
              <Text style={styles.suggestText}>
                Done. {group.subject?.name} now has {suggest} strikes in 90 days. The guidelines suggest a 7-day suspension.
              </Text>
              <Button
                label="Suspend for 7 days"
                onPress={() => {
                  setSuggest(null);
                  setAction('suspend');
                  setDays(7);
                }}
              />
              <Button label="Not now" variant="quiet" onPress={() => router.back()} />
            </View>
          ) : (
            <>
              <Text style={styles.label}>What to do</Text>
              <View style={styles.choices}>
                {choices.map((c) => (
                  <PressableScale
                    key={c.action}
                    onPress={() => {
                      setAction(c.action);
                      setDays(null);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: action === c.action }}
                    style={[styles.choice, action === c.action && styles.choiceOn]}>
                    <Text style={[styles.choiceLabel, action === c.action && styles.choiceLabelOn]}>{c.label}</Text>
                    <Text style={[styles.choiceDetail, action === c.action && styles.choiceLabelOn]}>{c.detail}</Text>
                  </PressableScale>
                ))}
              </View>

              {action === 'mute' || action === 'suspend' ? (
                <View style={styles.chips}>
                  {(action === 'mute' ? MUTE_DAYS : SUSPEND_DAYS).map((d) => (
                    <PressableScale
                      key={d}
                      onPress={() => setDays(d)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: days === d }}
                      style={[styles.chip, days === d && styles.choiceOn]}>
                      <Text style={[styles.chipText, days === d && styles.choiceLabelOn]}>
                        {d} {d === 1 ? 'day' : 'days'}
                      </Text>
                    </PressableScale>
                  ))}
                </View>
              ) : null}

              {action && action !== 'dismiss' ? (
                <>
                  <View style={styles.chips}>
                    {REASONS.map((r) => (
                      <PressableScale
                        key={r}
                        onPress={() => setReason(r)}
                        accessibilityRole="button"
                        style={[styles.reason, reason === r && styles.choiceOn]}>
                        <Text style={[styles.chipText, reason === r && styles.choiceLabelOn]}>{r}</Text>
                      </PressableScale>
                    ))}
                  </View>
                  <TextField
                    label="Reason"
                    value={reason}
                    onChangeText={setReason}
                    hint="The student sees this, and can appeal."
                    multiline
                    maxLength={1000}
                  />
                  {removable && !acted && action !== 'remove_content' ? (
                    <View style={styles.toggle}>
                      <Text style={styles.toggleText}>
                        Also remove the {(KIND_LABEL[group.target_kind] ?? 'content').toLowerCase()}
                      </Text>
                      <Switch
                        value={remove}
                        onValueChange={setRemove}
                        trackColor={{ true: theme.accentText, false: theme.border }}
                        thumbColor={brand.white}
                      />
                    </View>
                  ) : null}
                </>
              ) : null}

              <FormMessage message={error} />
              {action ? (
                <Button label={action === 'dismiss' ? 'Dismiss reports' : 'Confirm'} loading={saving} onPress={submit} />
              ) : null}
            </>
          )}
        </KeyboardScroll>
      </KeyboardFrame>
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  flex: { flex: 1 },
  empty: { fontFamily: fonts.body, fontSize: 15, color: t.textMuted, textAlign: 'center', marginTop: space.xl },
  content: { padding: space.xl, paddingTop: space.sm, gap: space.md, width: '100%', maxWidth: 640, alignSelf: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  tag: { backgroundColor: t.surface, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3 },
  tagUrgent: { backgroundColor: '#BE123C' },
  tagText: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.text },
  tagTextUrgent: { color: '#FFFFFF' },
  title: { fontFamily: fonts.bodyBold, fontSize: 19, color: t.text },
  meta: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
  label: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.textMuted, marginTop: space.sm },
  evidence: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  context: { gap: 4, borderLeftWidth: 3, borderLeftColor: t.border, paddingLeft: space.sm },
  contextText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: t.textMuted },
  evidenceText: { fontFamily: fonts.bodySemiBold, fontSize: 16, lineHeight: 23, color: t.text },
  block: { gap: space.xs },
  detail: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.text },
  subject: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.md, gap: 2 },
  subjectName: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  choices: { gap: space.sm },
  choice: { borderRadius: radius.md, padding: space.md, backgroundColor: t.surface, gap: 2 },
  choiceOn: { backgroundColor: t.focus },
  choiceLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  choiceLabelOn: { color: t.background },
  choiceDetail: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: t.surface },
  reason: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: t.surface },
  chipText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: t.text },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  toggleText: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 15, color: t.text },
  suggest: { backgroundColor: t.errorBg, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  suggestText: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 21, color: t.dangerText },
}));
