import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';

import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { TextField } from '@/components/ui/text-field';
import { dayMonth } from '@/lib/dates';
import { ACTION_LABEL, loadStanding, sendAppeal, type Standing, type StandingAction } from '@/lib/moderation';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

const APPEAL_STATUS = {
  open: 'Appeal sent. A different moderator will decide.',
  upheld: 'Appeal turned down',
  overturned: 'Appeal accepted',
};

// Every action the Uni Era team took on the student's account, with the reason, when it ends, and
// an appeal (once each, within 30 days). Used on the account screen and while suspended.
export function StandingView() {
  const theme = useTheme();
  const styles = useStyles();
  const [standing, setStanding] = useState<Standing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    loadStanding().then((r) => (r.error !== null ? setError(r.error) : setStanding(r.data)));
  }, [version]);

  if (!standing) {
    return error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} />;
  }

  return (
    <View style={styles.stack}>
      {standing.actions.length === 0 ? (
        <View style={styles.clear}>
          <CheckCircleIcon size={40} weight="fill" color={theme.accentText} />
          <Text style={styles.clearTitle}>All clear</Text>
          <Text style={styles.body}>No warnings or other actions on your account.</Text>
        </View>
      ) : (
        <>
          <Text style={styles.body}>
            {standing.strikes === 0
              ? 'No strikes in the last 90 days.'
              : `${standing.strikes} ${standing.strikes === 1 ? 'strike' : 'strikes'} in the last 90 days. Strikes older than 90 days stop counting.`}
            {standing.muted_until ? ` You are muted until ${dayMonth(standing.muted_until)}.` : ''}
          </Text>
          {standing.actions.map((a) => (
            <ActionCard key={a.id} action={a} onAppealed={() => setVersion((v) => v + 1)} />
          ))}
        </>
      )}
    </View>
  );
}

function ActionCard({ action, onAppealed }: { action: StandingAction; onAppealed: () => void }) {
  const styles = useStyles();
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setSending(true);
    setError(null);
    const r = await sendAppeal(action.id, text);
    setSending(false);
    if (r.error !== null) setError(r.error);
    else onAppealed();
  }

  return (
    <View style={[styles.card, action.revoked && styles.revoked]}>
      <View style={styles.head}>
        <Text style={styles.title}>{ACTION_LABEL[action.action]}</Text>
        <Text style={styles.date}>{dayMonth(action.created_at)}</Text>
      </View>
      <Text style={styles.reason}>{action.reason}</Text>
      {action.expires_at && !action.revoked ? <Text style={styles.meta}>Until {dayMonth(action.expires_at)}</Text> : null}
      {action.revoked ? <Text style={styles.meta}>Overturned. It no longer counts.</Text> : null}
      {action.appeal ? (
        <Text style={styles.meta}>
          {APPEAL_STATUS[action.appeal.status]}
          {action.appeal.note ? `: ${action.appeal.note}` : ''}
        </Text>
      ) : null}
      {action.can_appeal && !writing ? <Button label="Appeal" variant="quiet" onPress={() => setWriting(true)} /> : null}
      {writing ? (
        <View style={styles.form}>
          <TextField
            label="Why should this be overturned?"
            value={text}
            onChangeText={setText}
            hint="A moderator who did not take this action reads it."
            multiline
            maxLength={2000}
          />
          <FormMessage message={error} />
          <Button label="Send appeal" loading={sending} disabled={text.trim().length < 10} onPress={send} />
        </View>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  stack: { gap: space.md },
  clear: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  clearTitle: { fontFamily: fonts.bodyBold, fontSize: 18, color: t.text },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.text },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  revoked: { opacity: 0.6 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  date: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: t.textMuted },
  reason: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.text },
  meta: { fontFamily: fonts.bodySemiBold, fontSize: 13, lineHeight: 18, color: t.textMuted },
  form: { gap: space.sm, marginTop: space.sm },
}));
