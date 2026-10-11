import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { CircleIcon } from 'phosphor-react-native/src/icons/Circle';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { readCache, writeCache } from '@/lib/cache';
import { refreshChats } from '@/lib/chat/engine';
import { supabase } from '@/lib/supabase';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

export type ReportTarget =
  | { kind: 'message'; id: string; conversationId: string; who: string | null; userId: string | null }
  | { kind: 'profile'; id: string; who: string | null }
  | { kind: 'conversation'; id: string; who: string | null };

type Category = { code: string; label: string };
const CACHE_KEY = 'report:categories';
// Shown at once the first time, before the list arrives from the server.
const FALLBACK: Category[] = [
  { code: 'ragging_or_threats', label: 'Ragging or threats' },
  { code: 'self_harm', label: 'Self-harm or suicide' },
  { code: 'harassment', label: 'Harassment or bullying' },
  { code: 'sexual_content', label: 'Sexual content' },
  { code: 'scam', label: 'Scam or fraud' },
  { code: 'other', label: 'Something else' },
];

// Reporting a message, a student or a group to the Uni Era team. Their moderators see a copy of
// it (and, for a message, what was said around it); the person reported is never told who
// reported them. For a message or a student, you can block them in the same step.
export function ReportSheet({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const theme = useTheme();
  const styles = useStyles();
  const [categories, setCategories] = useState<Category[]>(() => readCache<Category[]>(CACHE_KEY) ?? FALLBACK);
  const [category, setCategory] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [block, setBlock] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!target) return;
    setCategory(null);
    setDetails('');
    setBlock(false);
    setError(null);
    setDone(false);
    supabase.rpc('report_categories').then(({ data }) => {
      if (!data?.length) return;
      setCategories(data as Category[]);
      writeCache(CACHE_KEY, data);
    });
  }, [target]);

  const blockable = target?.kind === 'profile' ? target.id : target?.kind === 'message' ? target.userId : null;

  async function send() {
    if (!target || !category) return;
    setSending(true);
    setError(null);
    const { error: failed } = await supabase.rpc('report', {
      p_kind: target.kind,
      p_target_id: target.id,
      p_category: category,
      ...(details.trim() ? { p_details: details.trim() } : {}),
      ...(target.kind === 'message' ? { p_conversation_id: target.conversationId } : {}),
    });
    if (!failed && block && blockable) {
      await supabase.rpc('block_user', { p_user_id: blockable });
      refreshChats();
    }
    setSending(false);
    if (failed) setError(failed.message);
    else setDone(true);
  }

  const title = done
    ? 'Thanks for telling us'
    : target?.kind === 'message'
      ? 'Report this message'
      : target?.kind === 'profile'
        ? `Report ${target.who ?? 'this student'}`
        : 'Report this group';

  return (
    <BottomSheet visible={!!target} title={title} onClose={onClose} height={0.8}>
      {done ? (
        <View style={styles.done}>
          <Text style={styles.doneText}>
            The Uni Era team will look at it. {target?.who ? `${target.who.split(' ')[0]} is` : 'They are'} not told who reported
            them.{block && blockable ? ' You have also blocked them.' : ''}
          </Text>
          <Text style={styles.urgent}>
            If someone is in danger right now, call 119 (police) or 1926 (mental health helpline).
          </Text>
          <Button label="Done" onPress={onClose} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.lead}>What is wrong?</Text>
          <View style={styles.options} accessibilityRole="radiogroup">
            {categories.map((c) => {
              const chosen = category === c.code;
              return (
                <Pressable
                  key={c.code}
                  onPress={() => setCategory(c.code)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: chosen }}
                  style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
                  {chosen ? (
                    <CheckCircleIcon size={22} color={theme.tickRead} weight="fill" />
                  ) : (
                    <CircleIcon size={22} color={theme.textMuted} />
                  )}
                  <Text style={[styles.optionText, chosen && styles.optionChosen]}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={details}
            onChangeText={setDetails}
            placeholder="Anything else we should know (optional)"
            placeholderTextColor={theme.textMuted}
            multiline
            maxLength={1000}
            style={styles.details}
            selectionColor={brand.accent}
            accessibilityLabel="Details"
          />
          {blockable ? (
            <View style={styles.blockRow}>
              <View style={styles.blockText}>
                <Text style={styles.optionText}>Also block {target?.who?.split(' ')[0] ?? 'them'}</Text>
                <Text style={styles.hint}>They will not be able to message you or see your profile.</Text>
              </View>
              <Switch
                value={block}
                onValueChange={setBlock}
                trackColor={{ true: theme.accentText, false: theme.border }}
                thumbColor={brand.white}
                accessibilityLabel="Also block"
              />
            </View>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="Send report" onPress={send} disabled={!category} loading={sending} />
          <Text style={styles.hint}>Reports go to Uni Era's moderators, not to the group or its reps.</Text>
        </ScrollView>
      )}
    </BottomSheet>
  );
}

const useStyles = createThemedStyles((t) => ({
  body: { paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.md },
  lead: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  options: { gap: 2 },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderRadius: radius.md },
  pressed: { opacity: 0.6 },
  optionText: { fontFamily: fonts.body, fontSize: 16, color: t.text },
  optionChosen: { fontFamily: fonts.bodyBold },
  details: {
    minHeight: 80,
    borderRadius: radius.md,
    backgroundColor: t.surface,
    padding: space.md,
    fontFamily: fonts.body,
    fontSize: 15,
    color: t.text,
    textAlignVertical: 'top',
  },
  blockRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  blockText: { flex: 1, gap: 2 },
  hint: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: t.textMuted },
  error: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.dangerText },
  done: { paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.lg },
  doneText: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: t.text },
  urgent: { fontFamily: fonts.bodySemiBold, fontSize: 14, lineHeight: 20, color: t.textMuted },
}));
