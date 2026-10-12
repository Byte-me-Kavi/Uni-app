import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { CircleIcon } from 'phosphor-react-native/src/icons/Circle';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';

import { PressableScale } from '@/components/ui/pressable-scale';
import { readCache, writeCache } from '@/lib/cache';
import { openChat } from '@/lib/chat/open-chat';
import { useMyExams } from '@/lib/exams';
import type { Overview } from '@/lib/library';
import type { BatchModules } from '@/lib/modules';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Start = { batch_chat_id: string | null; batch_chat_opened: boolean };
type Flags = { opened?: boolean; asked?: boolean; dismissed?: boolean };

// Getting started, while the student's library is still empty: this semester's modules, the batch
// chat (where notes and links arrive and file themselves), and exam dates. Each step ticks itself off;
// the card goes once all are done (or the student hides it).
export function FirstWeek({ data, overview }: { data: BatchModules; overview: Overview | null }) {
  const theme = useTheme();
  const styles = useStyles();
  const session = useSession();
  const uid = session.status === 'signed_in' ? session.session.user.id : null;
  const { data: exams } = useMyExams();
  const [start, setStart] = useState<Start | null>(() => (uid ? readCache<Start>(`${uid}:first-week-start`) : null));
  const [flags, setFlags] = useState<Flags>(() => (uid ? (readCache<Flags>(`${uid}:first-week`) ?? {}) : {}));

  const empty = !!overview && overview.to_sort === 0 && overview.modules.every((m) => m.count === 0);

  useEffect(() => {
    if (!uid || !empty || flags.dismissed) return;
    let live = true;
    supabase.rpc('resources_start').then(({ data: next }) => {
      if (!live || !next) return;
      setStart(next as Start);
      writeCache(`${uid}:first-week-start`, next);
    });
    return () => {
      live = false;
    };
  }, [uid, empty, flags.dismissed]);

  function note(change: Flags) {
    const next = { ...flags, ...change };
    setFlags(next);
    if (uid) writeCache(`${uid}:first-week`, next);
  }

  const chat = start?.batch_chat_id ?? null;
  const term = data.term;
  const rep = !!exams?.can_edit;
  const steps = [
    {
      key: 'modules',
      label: "Add this semester's modules",
      body: 'Once for your whole batch: lists from other batches of your degree are suggested.',
      done: data.current.length > 0,
      go: () => term && router.push({ pathname: '/semester', params: { year: String(term.year), semester: String(term.semester) } }),
    },
    {
      key: 'chat',
      label: 'Open your batch chat',
      body: 'Notes, slides and links sent there file into your modules by themselves.',
      done: !!start?.batch_chat_opened || !!flags.opened,
      go: () => {
        if (!chat) return;
        note({ opened: true });
        openChat(chat);
      },
    },
    {
      key: 'exams',
      label: rep ? 'Add your exam dates' : 'Ask your rep to add exam dates',
      body: rep ? 'Once for your batch: every module then shows its countdown.' : 'Then every module shows its countdown. Ask in your batch chat.',
      done: (exams?.exams.length ?? 0) > 0 || !!flags.asked,
      go: () => {
        if (rep) return router.push('/exams');
        if (!chat) return;
        note({ asked: true });
        openChat(chat);
      },
    },
  ];
  const done = steps.filter((s) => s.done).length;

  if (!empty || flags.dismissed || done === steps.length) return null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text style={styles.title} accessibilityRole="header">
            Getting started
          </Text>
          <Text style={styles.meta}>
            {done} of {steps.length} done
          </Text>
        </View>
        <PressableScale onPress={() => note({ dismissed: true })} accessibilityRole="button" accessibilityLabel="Hide getting started" hitSlop={8}>
          <Text style={styles.link}>Hide</Text>
        </PressableScale>
      </View>
      {steps.map((s) => (
        <PressableScale
          key={s.key}
          onPress={s.go}
          disabled={s.done}
          accessibilityRole="button"
          accessibilityState={{ checked: s.done, disabled: s.done }}
          accessibilityLabel={`${s.label}${s.done ? ', done' : ''}`}
          style={styles.step}>
          {s.done ? (
            <CheckCircleIcon size={24} weight="fill" color={theme.accentText} />
          ) : (
            <CircleIcon size={24} weight="bold" color={theme.textMuted} />
          )}
          <View style={styles.flex}>
            <Text style={[styles.label, s.done && styles.labelDone]}>{s.label}</Text>
            {!s.done ? <Text style={styles.meta}>{s.body}</Text> : null}
          </View>
          {!s.done ? <CaretRightIcon size={16} weight="bold" color={theme.textMuted} /> : null}
        </PressableScale>
      ))}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  card: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingBottom: space.xs },
  flex: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.display, fontSize: 18, color: t.text },
  meta: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: t.textMuted },
  link: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.accentText },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingVertical: space.xs },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  labelDone: { color: t.textMuted, textDecorationLine: 'line-through' },
}));
