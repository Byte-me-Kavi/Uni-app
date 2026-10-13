import { useEffect, useSyncExternalStore } from 'react';

import { readCache, writeCache } from '@/lib/cache';
import { useModulesSnapshot, type MyModules } from '@/lib/modules';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';
import { useScheme } from '@/theme/appearance';

// A colour per module, so a student knows "the green one is Data Structures" before reading. Muted
// tints, never the accent (that means buttons and selection) or red (errors). Each colour has a light
// and a dark version; the text colour (fg) on its tint (bg) is at least 5:1 in both, and muted text
// on the tint at least 6:1.
//
// The app gives this semester's modules different colours by default; a student can pick their own
// (kept on the server, so every phone they use shows the same).

export const MODULE_COLOURS = ['teal', 'green', 'amber', 'clay', 'rose', 'violet', 'indigo', 'slate'] as const;
export type ModuleColour = (typeof MODULE_COLOURS)[number];
export type Swatch = { key: ModuleColour; label: string; bg: string; fg: string };

const LABELS: Record<ModuleColour, string> = {
  teal: 'Teal',
  green: 'Green',
  amber: 'Amber',
  clay: 'Clay',
  rose: 'Rose',
  violet: 'Violet',
  indigo: 'Indigo',
  slate: 'Slate',
};

const TONES: Record<'light' | 'dark', Record<ModuleColour, { bg: string; fg: string }>> = {
  light: {
    teal: { bg: '#DDF3EE', fg: '#0F6B5C' }, // 5.5:1
    green: { bg: '#E3F2DD', fg: '#3A6B1F' }, // 5.5:1
    amber: { bg: '#FBEFD5', fg: '#8A5A00' }, // 5.2:1
    clay: { bg: '#FDE6DA', fg: '#A5431A' }, // 5.1:1
    rose: { bg: '#FBE3EC', fg: '#A3245A' }, // 5.9:1
    violet: { bg: '#ECE6FB', fg: '#5B3FB0' }, // 6.2:1
    indigo: { bg: '#E2E8FB', fg: '#3347A8' }, // 6.6:1
    slate: { bg: '#E8EAEE', fg: '#444C5A' }, // 7.2:1
  },
  dark: {
    teal: { bg: '#0E2B27', fg: '#6FD3BF' }, // 8.4:1
    green: { bg: '#182A12', fg: '#9BD47A' }, // 8.8:1
    amber: { bg: '#2E2410', fg: '#F2C46B' }, // 9.4:1
    clay: { bg: '#33190F', fg: '#F7A27C' }, // 8.1:1
    rose: { bg: '#33121F', fg: '#F49AC0' }, // 8.2:1
    violet: { bg: '#221A3A', fg: '#B9A5F5' }, // 7.6:1
    indigo: { bg: '#161D3A', fg: '#9DB0F5' }, // 7.8:1
    slate: { bg: '#1E2229', fg: '#B7BFCC' }, // 8.6:1
  },
};

export function swatch(key: ModuleColour, scheme: 'light' | 'dark'): Swatch {
  return { key, label: LABELS[key], ...TONES[scheme][key] };
}

const hashed = (id: number) => MODULE_COLOURS[(Math.imul(id, 2654435761) >>> 0) >>> 29];

/** A steady colour for anything with a text id (a person's initials): the same id, the same colour. */
export function colourFor(id: string, scheme: 'light' | 'dark'): Swatch {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 2654435761);
  return swatch(MODULE_COLOURS[(h >>> 0) % MODULE_COLOURS.length], scheme);
}

// ---------------------------------------------------------------------------------------------
// The student's choices
// ---------------------------------------------------------------------------------------------

type Chosen = Record<string, ModuleColour>;

let owner: string | null = null;
let chosen: Chosen = {};
let loaded: string | null = null;
const listeners = new Set<() => void>();

function adopt(uid: string, next: Chosen) {
  owner = uid;
  chosen = next;
  writeCache(`${uid}:module-colours`, next);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function ensure(uid: string | null) {
  if (!uid || loaded === uid) return;
  loaded = uid;
  if (owner !== uid) {
    owner = uid;
    chosen = readCache<Chosen>(`${uid}:module-colours`) ?? {};
    listeners.forEach((l) => l());
  }
  supabase.rpc('module_colours').then(({ data }) => {
    if (data && typeof data === 'object') adopt(uid, data as Chosen);
    else loaded = null;
  });
}

/** Picks a module's colour; null goes back to the app's choice. Returns an error message or null. */
export async function setModuleColour(uid: string, moduleId: number, colour: ModuleColour | null) {
  const before = chosen;
  const next = { ...chosen };
  if (colour) next[String(moduleId)] = colour;
  else delete next[String(moduleId)];
  adopt(uid, next); // straight away; put back if the server says no
  const { data, error } = await supabase.rpc('set_module_colour', { p_module_id: moduleId, p_colour: colour as string });
  if (error || !data) {
    adopt(uid, before);
    return error?.message ?? 'Could not change the colour. Try again.';
  }
  adopt(uid, data as Chosen);
  return null;
}

// ---------------------------------------------------------------------------------------------
// Who gets which colour
// ---------------------------------------------------------------------------------------------

let memo: { data: MyModules | null; chosen: Chosen; map: Map<number, ModuleColour> } | null = null;

// This semester's modules get different colours (their hashed colour, or the next free one), so no
// two tiles on the Resources tab look alike. Other modules keep their hashed colour.
function assign(data: MyModules | null, picks: Chosen) {
  if (memo && memo.data === data && memo.chosen === picks) return memo.map;
  const map = new Map<number, ModuleColour>();
  const current = data?.batch ? [...data.current, ...data.electives].map((m) => m.id).sort((a, b) => a - b) : [];
  const used = new Set<ModuleColour>(current.map((id) => picks[String(id)]).filter(Boolean));
  for (const id of current) {
    const pick = picks[String(id)];
    if (pick) {
      map.set(id, pick);
      continue;
    }
    if (used.size >= MODULE_COLOURS.length) used.clear();
    const start = MODULE_COLOURS.indexOf(hashed(id));
    let colour = hashed(id);
    for (let i = 0; i < MODULE_COLOURS.length; i++) {
      const c = MODULE_COLOURS[(start + i) % MODULE_COLOURS.length];
      if (!used.has(c)) {
        colour = c;
        break;
      }
    }
    used.add(colour);
    map.set(id, colour);
  }
  for (const [id, pick] of Object.entries(picks)) if (!map.has(Number(id))) map.set(Number(id), pick);
  memo = { data, chosen: picks, map };
  return map;
}

/** A module's colour for this student, in the current light or dark mode. */
export function useModuleColour(moduleId: number): Swatch {
  const session = useSession();
  const uid = session.status === 'signed_in' ? session.session.user.id : null;
  const data = useModulesSnapshot();
  const picks = useSyncExternalStore(subscribe, () => (owner === uid ? chosen : EMPTY));
  const scheme = useScheme();
  useEffect(() => ensure(uid), [uid]);
  return swatch(assign(data, picks).get(moduleId) ?? hashed(moduleId), scheme);
}

/** Whether the student picked this module's colour themselves (or it is the app's choice). */
export function useChosenColour(moduleId: number): ModuleColour | null {
  const session = useSession();
  const uid = session.status === 'signed_in' ? session.session.user.id : null;
  const picks = useSyncExternalStore(subscribe, () => (owner === uid ? chosen : EMPTY));
  return picks[String(moduleId)] ?? null;
}

const EMPTY: Chosen = {};
