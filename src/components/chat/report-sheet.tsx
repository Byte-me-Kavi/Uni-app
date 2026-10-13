import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { CircleIcon } from 'phosphor-react-native/src/icons/Circle';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { readCache, writeCache } from '@/lib/cache';
import { refreshChats } from '@/lib/chat/engine';
import { HelpList } from '@/components/safety/help-list';
import { supabase } from '@/lib/supabase';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

export type ReportTarget =
  | { kind: 'message'; id: string; conversationId: string; who: string | null; userId: string | null }
  | { kind: 'profile'; id: string; who: string | null }
  | { kind: 'conversation'; id: string; who: string | null }
  /** A kuppi (its host) or a shared file (its uploader), from Resources; a shop listing (its seller). */
  | { kind: 'kuppi' | 'resource' | 'listing'; id: string; who: string | null; userId: string | null }
  /** A kuppi request (anonymous) or a comment on a shared file. */
  | { kind: 'kuppi_request' | 'comment'; id: string; who: string | null; userId: string | null }
  /** A post in the feed, or a comment on one. */
  | { kind: 'post' | 'post_comment'; id: string; who: string | null; userId: string | null }
  /** A freshers' question (shown without a name) or an ambassador's answer. */
  | { kind: 'fresher_question' | 'fresher_answer'; id: string; who: string | null; userId: null };

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

  const blockable =
    target?.kind === 'profile'
      ? target.id
      : target?.kind === 'message' ||
          target?.kind === 'kuppi' ||
          target?.kind === 'resource' ||
          target?.kind === 'comment' ||
          target?.kind === 'listing' ||
          target?.kind === 'post' ||
          target?.kind === 'post_comment'
        ? target.userId
        : null;

  async function send() {
    if (!target || !category) return;
    setSending(true);
    setError(null);
    const extra = details.trim() ? { p_details: details.trim() } : {};
    const { error: failed } =
      target.kind === 'kuppi'
        ? await supabase.rpc('report_kuppi', { p_session_id: target.id, p_category: category, ...extra })
        : target.kind === 'resource'
          ? await supabase.rpc('report_resource', { p_resource_id: target.id, p_category: category, ...extra })
          : target.kind === 'kuppi_request'
            ? await supabase.rpc('report_kuppi_request', { p_request_id: target.id, p_category: category, ...extra })
            : target.kind === 'comment'
              ? await supabase.rpc('report_comment', { p_comment_id: target.id, p_category: category, ...extra })
              : target.kind === 'listing'
                ? await supabase.rpc('report_listing', { p_listing_id: target.id, p_category: category, ...extra })
                : target.kind === 'post' || target.kind === 'post_comment'
                  ? await supabase.rpc('report_post', {
                      p_kind: target.kind,
                      p_id: Number(target.id),
                      p_category: category,
                      ...extra,
                    })
                  : target.kind === 'fresher_question' || target.kind === 'fresher_answer'
                    ? await supabase.rpc('report_fresher_item', {
                        p_kind: target.kind === 'fresher_question' ? 'question' : 'answer',
                        p_id: Number(target.id),
                        p_category: category,
                        ...extra,
                      })
                    : await supabase.rpc('report', {
                        p_kind: target.kind,
                        p_target_id: target.id,
                        p_category: category,
                        ...extra,
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
        : target?.kind === 'kuppi'
          ? 'Report this kuppi'
          : target?.kind === 'resource'
            ? 'Report this file'
            : target?.kind === 'kuppi_request'
              ? 'Report this request'
              : target?.kind === 'comment'
                ? 'Report this comment'
                : target?.kind === 'listing'
                  ? 'Report this listing'
                  : target?.kind === 'post'
                    ? 'Report this post'
                    : target?.kind === 'post_comment'
                      ? 'Report this comment'
                      : 'Report this group';

  return (
    <BottomSheet visible={!!target} title={title} onClose={onClose} height={0.8}>
      {done ? (
        <View style={styles.done}>
          <Text style={styles.doneText}>
            The Uni Era team will look at it. {target?.who ? `${target.who.split(' ')[0]} is` : 'They are'} not told who reported
            them.{block && blockable ? ' You have also blocked them.' : ''}
          </Text>
          {category === 'ragging_or_threats' || category === 'self_harm' ? (
            <ScrollView style={styles.help} contentContainerStyle={styles.helpContent}>
              <Text style={styles.urgent}>
                {category === 'self_harm'
                  ? 'If you or someone else might be in danger, talk to someone now:'
                  : 'You can also go straight to the people who deal with ragging:'}
              </Text>
              <HelpList kinds={category === 'self_harm' ? ['emergency', 'wellbeing'] : ['emergency', 'ragging', 'security']} />
            </ScrollView>
          ) : (
            <Text style={styles.urgent}>
              If someone is in danger right now, call 119 (police) or 1926 (mental health helpline).
            </Text>
          )}
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
            selectionColor={theme.accent}
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
  help: { maxHeight: 360 },
  helpContent: { gap: space.md },
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
