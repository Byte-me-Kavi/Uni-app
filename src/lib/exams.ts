import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { readCache, writeCache } from '@/lib/cache';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';

// The batch's exam dates (api.my_exams): set once by a rep for everyone. Shared by the Resources
// tab, Home and module screens, kept on the phone so countdowns show at once, offline too.

export type ExamKind = 'final' | 'mid' | 'quiz' | 'practical' | 'deadline';

export const EXAM_KINDS: { key: ExamKind; label: string }[] = [
  { key: 'final', label: 'Final exam' },
  { key: 'mid', label: 'Mid-semester exam' },
  { key: 'quiz', label: 'Quiz' },
  { key: 'practical', label: 'Practical' },
  { key: 'deadline', label: 'Assignment due' },
];

export type Exam = {
  id: string;
  kind: ExamKind;
  starts_at: string;
  venue: string | null;
  days: number;
  set_by: string | null;
  module: { id: number; code: string; name: string };
};

export type MyExams = { exams: Exam[]; can_edit: boolean };

/** Exam season: an exam within this many days. */
export const EXAM_SEASON_DAYS = 30;

export const examLabel = (kind: ExamKind) => EXAM_KINDS.find((k) => k.key === kind)?.label ?? 'Exam';

/** "today", "tomorrow", "in 12 days" */
export function daysText(days: number) {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

type State = { key: string | null; data: MyExams | null };
let state: State = { key: null, data: null };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

function adopt(data: MyExams) {
  set({ key: state.key, data });
  if (state.key) writeCache(state.key, data);
}

export function refreshExams() {
  if (loading) return loading;
  loading = (async () => {
    const { data, error } = await supabase.rpc('my_exams');
    if (!error && data) adopt(data as MyExams);
  })().finally(() => {
    loading = null;
  });
  return loading;
}

export function useMyExams() {
  const session = useSession();
  const key = session.status === 'signed_in' ? `${session.session.user.id}:exams` : null;
  const snapshot = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
  useEffect(() => {
    if (state.key !== key) set({ key, data: key ? readCache<MyExams>(key) : null });
    if (key) refreshExams();
  }, [key]);
  const refresh = useCallback(() => refreshExams(), []);
  return { data: snapshot.key === key ? snapshot.data : key ? readCache<MyExams>(key) : null, refresh };
}

/** The soonest exam for a module, if any. */
export function nextExamFor(data: MyExams | null, moduleId: number) {
  return data?.exams.find((e) => e.module.id === moduleId) ?? null;
}

async function change(call: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const { data, error } = await call;
  if (error || !data) return error?.message ?? 'Something went wrong. Try again.';
  adopt(data as MyExams);
  return null;
}

export function setExam(moduleId: number, kind: ExamKind, startsAt: Date, venue?: string) {
  return change(
    supabase.rpc('set_exam', {
      p_module_id: moduleId,
      p_kind: kind,
      p_starts_at: startsAt.toISOString(),
      ...(venue?.trim() ? { p_venue: venue.trim() } : {}),
    }),
  );
}

export function removeExam(id: string) {
  return change(supabase.rpc('remove_exam', { p_exam_id: id }));
}
