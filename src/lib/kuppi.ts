import { Linking } from 'react-native';

import { supabase } from '@/lib/supabase';

// Kuppi: peer tutoring sessions on Zoom, Meet or Teams, or in person (see the kuppi migration).
// The server enforces capacity and only reveals the meeting link to the host and to students who
// RSVP'd, from 15 minutes before the start.

export type Kuppi = {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  link_opens_at: string;
  mode: 'online' | 'in_person';
  venue: string | null;
  platform: 'zoom' | 'meet' | 'teams' | null;
  capacity: number;
  going: number;
  full: boolean;
  cancelled: boolean;
  cancel_reason: string | null;
  hosting: boolean;
  rsvped: boolean;
  host: { id: string; name: string; avatar_path: string | null } | null;
  module: { id: number; code: string; name: string };
  chat_id: string | null;
  /** 'national': open to students at every university taking the subject (always online). */
  scope: 'university' | 'national';
  /** Hosted at another university (open to all universities). */
  other: boolean;
  /** The host's university, short name. */
  institution: string | null;
};

export type KuppiScope = 'my_modules' | 'module' | 'mine' | 'all';

export const PLATFORM_LABEL = { zoom: 'Zoom', meet: 'Google Meet', teams: 'Microsoft Teams' } as const;

export async function listKuppi(scope: KuppiScope, moduleId?: number) {
  const { data, error } = await supabase.rpc('kuppi_list', {
    p_scope: scope,
    ...(moduleId ? { p_module_id: moduleId } : {}),
    p_limit: 50,
  });
  if (error) return { list: null, error: error.message };
  return { list: (data ?? []) as Kuppi[], error: null };
}

export async function loadKuppi(id: string) {
  const { data, error } = await supabase.rpc('kuppi', { p_session_id: id });
  if (error || !data) return { kuppi: null, error: error?.message ?? 'This kuppi is not available.' };
  return { kuppi: data as Kuppi, error: null };
}

async function change(call: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const { data, error } = await call;
  if (error || !data) return { kuppi: null, error: error?.message ?? 'Something went wrong. Try again.' };
  return { kuppi: data as Kuppi, error: null };
}

export const rsvp = (id: string) => change(supabase.rpc('rsvp', { p_session_id: id }));
export const cancelRsvp = (id: string) => change(supabase.rpc('cancel_rsvp', { p_session_id: id }));
export const cancelKuppi = (id: string, reason?: string) =>
  change(supabase.rpc('cancel_kuppi', { p_session_id: id, ...(reason ? { p_reason: reason } : {}) }));

export type NewKuppi = {
  moduleId: number;
  title: string;
  startsAt: Date;
  minutes: number;
  mode: 'online' | 'in_person';
  capacity: number;
  meetingUrl?: string;
  venue?: string;
  description?: string;
  /** The request this kuppi answers. */
  requestId?: string;
  /** 'national': open to all universities (online only). Answering another university's request always is. */
  scope?: 'university' | 'national';
};

export function createKuppi(k: NewKuppi) {
  return change(
    supabase.rpc('create_kuppi', {
      p_module_id: k.moduleId,
      p_title: k.title,
      p_starts_at: k.startsAt.toISOString(),
      p_minutes: k.minutes,
      p_mode: k.mode,
      p_capacity: k.capacity,
      ...(k.meetingUrl ? { p_meeting_url: k.meetingUrl } : {}),
      ...(k.venue ? { p_venue: k.venue } : {}),
      ...(k.description ? { p_description: k.description } : {}),
      ...(k.requestId ? { p_request_id: k.requestId } : {}),
      ...(k.scope ? { p_scope: k.scope } : {}),
    }),
  );
}

/** Opens the meeting in the Zoom, Meet or Teams app (their links open the app when installed). */
export async function joinKuppi(id: string) {
  const { data, error } = await supabase.rpc('reveal_link', { p_session_id: id });
  if (error) return error.message;
  const url = (data as { url: string | null } | null)?.url;
  if (!url || !/^https:\/\//.test(url)) return 'The link is not available.';
  try {
    await Linking.openURL(url);
    return null;
  } catch {
    return 'Could not open the meeting app.';
  }
}

/** "CS2012", "CS2012 · All universities", or "CO222 · TMU" for a kuppi hosted at another university. */
export function kuppiPlace(k: Pick<Kuppi, 'module' | 'scope' | 'other' | 'institution'>) {
  if (k.other) return `${k.module.code} · ${k.institution ?? 'Another university'}`;
  return k.scope === 'national' ? `${k.module.code} · All universities` : k.module.code;
}

/** Mon 14 Oct · 7:00 pm – 8:30 pm */
export function kuppiWhen(k: Pick<Kuppi, 'starts_at' | 'ends_at'>) {
  const start = new Date(k.starts_at);
  const end = new Date(k.ends_at);
  const day = start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time(start)} – ${time(end)}`;
}

// ---------------------------------------------------------------------------------------------
// Requests: "I need help with AVL trees", with votes. Anonymous to other students. Asked of all
// universities, a request reaches every student taking the same national subject.
// ---------------------------------------------------------------------------------------------

export type KuppiRequest = {
  id: string;
  topic: string;
  details: string | null;
  votes: number;
  voted: boolean;
  /** The student asked it themselves. */
  mine: boolean;
  closed: boolean;
  /** Someone hosted a kuppi for it (session is null when it is one the student cannot join). */
  answered: boolean;
  created_at: string;
  scope: 'university' | 'national';
  /** Asked at another university. */
  other: boolean;
  /** Where it was asked, short name. */
  institution: string | null;
  /** How many universities want it (requests asked of all universities). */
  universities: number | null;
  module: { id: number; code: string; name: string };
  /** The student's module to host an answer under; null when they take none on the subject. */
  host_module_id: number | null;
  /** The kuppi that answers it, once someone hosts one. */
  session: { id: string; title: string; starts_at: string; cancelled: boolean } | null;
  /** A similar request existed: the student's vote went to it. */
  merged?: boolean;
};

export async function listRequests(scope: 'my_modules' | 'module' | 'all', moduleId?: number) {
  const { data, error } = await supabase.rpc('kuppi_requests', { p_scope: scope, ...(moduleId ? { p_module_id: moduleId } : {}) });
  if (error) return { list: null, error: error.message };
  return { list: (data ?? []) as KuppiRequest[], error: null };
}

export async function requestKuppi(moduleId: number, topic: string, details?: string, scope: 'university' | 'national' = 'national') {
  const { data, error } = await supabase.rpc('request_kuppi', {
    p_module_id: moduleId,
    p_topic: topic,
    p_scope: scope,
    ...(details?.trim() ? { p_details: details.trim() } : {}),
  });
  if (error || !data) return { request: null, error: error?.message ?? 'Could not send. Try again.' };
  return { request: data as KuppiRequest, error: null };
}

export async function voteRequest(id: string, on: boolean) {
  const { data, error } = await supabase.rpc('vote_kuppi_request', { p_request_id: id, p_on: on });
  if (error || !data) return { request: null, error: error?.message ?? 'Could not vote. Try again.' };
  return { request: data as KuppiRequest, error: null };
}

export async function closeRequest(id: string) {
  const { error } = await supabase.rpc('close_kuppi_request', { p_request_id: id });
  return error?.message ?? null;
}
