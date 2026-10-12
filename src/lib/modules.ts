import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { readCache, writeCache } from '@/lib/cache';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';

// The student's modules, semester by semester (api.my_modules). One copy is shared by every
// screen that shows modules (the Resources tab, a module, the semester editor), kept on the phone
// so the tab opens filled, and refreshed behind it. Changes return the new state, so screens
// update from the server's answer rather than guessing.

export type ModuleKind = 'core' | 'elective' | 'repeat';

export type ModuleCard = {
  id: number;
  code: string;
  name: string;
  /** The student's course chat for this module, once they are in it. */
  chat_id: string | null;
  kind?: ModuleKind;
  /** Added by the student and waiting for batchmates. */
  pending?: boolean;
  votes?: number;
  /** Electives: whether the student takes it. */
  taking?: boolean;
};

export type Term = {
  year: number;
  semester: number;
  /** False while the batch has not agreed on it: it is the semester this student asked for. */
  confirmed: boolean;
  set_at: string | null;
  /** Days since the batch set it. */
  days: number | null;
  votes: number | null;
};

export type BatchModules = {
  batch: { name: string; programme: string; intake_year: number };
  can_edit: boolean;
  votes_needed: number;
  terms_per_year: number;
  term: Term | null;
  my_term_vote: { year: number; semester: number; votes: number } | null;
  current: ModuleCard[];
  electives: ModuleCard[];
  not_taking: ModuleCard[];
  past: { year: number; semester: number; modules: ModuleCard[] }[];
};

export type MyModules = { batch: null } | BatchModules;

export type PlanModule = { id: number; code: string; name: string; kind: 'core' | 'elective' };
export type SemesterPlan = {
  year: number;
  semester: number;
  can_edit: boolean;
  votes_needed: number;
  modules: PlanModule[];
  proposals: (PlanModule & { votes: number; mine: boolean })[];
  suggestions: (PlanModule & { from: string })[];
};

export type ModuleMatch = { id: number; code: string; name: string; batches: number };

type State = { key: string | null; data: MyModules | null; status: 'idle' | 'loading' | 'ready' | 'error' };

let state: State = { key: null, data: null, status: 'idle' };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function adopt(data: MyModules) {
  set({ data, status: 'ready' });
  if (state.key) writeCache(state.key, data);
}

async function load() {
  if (inflight) return inflight;
  if (!state.data) set({ status: 'loading' });
  inflight = (async () => {
    const { data, error } = await supabase.rpc('my_modules');
    if (error || !data) {
      set({ status: state.data ? 'ready' : 'error' });
    } else {
      adopt(data as MyModules);
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** The modules already in memory, without loading anything (for small parts drawn many times, like a
 * module's colour dot). Screens use useMyModules. */
export function useModulesSnapshot(): MyModules | null {
  return useSyncExternalStore(subscribe, () => state.data);
}

/** The student's modules, from the phone first, then the server. */
export function useMyModules() {
  const session = useSession();
  const key = session.status === 'signed_in' ? `${session.session.user.id}:modules` : null;

  const snapshot = useSyncExternalStore(subscribe, () => state);
  const mine = snapshot.key === key;

  useEffect(() => {
    // Another account on this phone starts from its own copy.
    if (state.key !== key) set({ key, data: key ? readCache<MyModules>(key) : null, status: 'idle' });
    if (key) load();
  }, [key]);

  const refresh = useCallback(() => load(), []);
  // Until the store has switched to this account, its copy on the phone fills the first frame.
  return {
    data: mine ? snapshot.data : key ? readCache<MyModules>(key) : null,
    status: mine ? snapshot.status : 'idle',
    refresh,
  };
}

/** Every change answers with the student's modules as they now are. */
async function change(call: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const { data, error } = await call;
  if (error || !data) return error?.message ?? 'Something went wrong. Try again.';
  adopt(data as MyModules);
  return null;
}

/** Sets (reps) or asks for (everyone else) the batch's semester. Returns an error message or null. */
export function setBatchTerm(year: number, semester: number) {
  return change(supabase.rpc('set_batch_term', { p_year: year, p_semester: semester }));
}

/** 'taking' an elective, 'not_taking' a core module, 'repeat' an earlier one, or null for the default. */
export function setModuleChoice(moduleId: number, choice: 'taking' | 'not_taking' | 'repeat' | null) {
  // null clears the choice; the generated types cannot say a SQL argument may be null.
  return change(supabase.rpc('set_module_choice', { p_module_id: moduleId, p_choice: choice as string }));
}

export async function loadSemesterPlan(year: number, semester: number) {
  const { data, error } = await supabase.rpc('semester_plan', { p_year: year, p_semester: semester });
  if (error || !data) return { plan: null, error: error?.message ?? 'Could not load this semester.' };
  return { plan: data as SemesterPlan, error: null };
}

export type SaveItem = { module_id: number; kind: 'core' | 'elective' } | { code: string; name: string; kind: 'core' | 'elective' };

export async function saveSemester(year: number, semester: number, items: SaveItem[]) {
  const { data, error } = await supabase.rpc('save_semester', { p_year: year, p_semester: semester, p_items: items });
  if (error || !data) return { plan: null, error: error?.message ?? 'Could not save. Try again.' };
  load();
  return { plan: data as SemesterPlan, error: null };
}

export async function findModules(query: string) {
  const { data } = await supabase.rpc('find_modules', { p_query: query });
  return (data ?? []) as ModuleMatch[];
}

export async function renameModule(moduleId: number, name: string) {
  const { error } = await supabase.rpc('rename_module', { p_module_id: moduleId, p_name: name });
  if (error) return error.message;
  load();
  return null;
}

export function termLabel(t: { year: number; semester: number }) {
  return `Year ${t.year} · Semester ${t.semester}`;
}

/** Degrees are 4 years of 2 semesters (the server enforces the same). */
export const YEARS_OF_STUDY = [1, 2, 3, 4] as const;
export const SEMESTERS = [1, 2] as const;

/** The semester after this one, or null after Year 4 · Semester 2. */
export function nextTerm(t: { year: number; semester: number }) {
  if (t.semester < SEMESTERS.length) return { year: t.year, semester: t.semester + 1 };
  if (t.year < YEARS_OF_STUDY.length) return { year: t.year + 1, semester: 1 };
  return null;
}

/** Looks like a module code (letters then a digit): searched by code, and offered as a new module. */
export function looksLikeCode(text: string) {
  return /^[A-Za-z]{1,8}[\s._/-]*[0-9][A-Za-z0-9\s._/-]*$/.test(text.trim());
}

/** A module anywhere in the student's lists, for the module screen. */
export function findCard(data: MyModules | null, id: number): ModuleCard | null {
  if (!data || !data.batch) return null;
  const all = [...data.current, ...data.electives, ...data.not_taking, ...data.past.flatMap((p) => p.modules)];
  return all.find((m) => m.id === id) ?? null;
}
