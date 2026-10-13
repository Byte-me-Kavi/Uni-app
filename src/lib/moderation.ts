import { onSignOut } from '@/lib/resets';
import { supabase } from '@/lib/supabase';

// Reports, penalties and appeals. Moderators work the queue and act with a written reason; students
// see every action on their account and can appeal each once, decided by a different moderator.

type Result<T> = { data: T; error: null } | { data: null; error: string };

async function result<T>(call: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Result<T>> {
  const { data, error } = await call;
  if (error) return { data: null, error: error.message };
  return { data: data as T, error: null };
}

export type ActionKind = 'dismiss' | 'remove_content' | 'warn' | 'mute' | 'suspend' | 'ban';

export const ACTION_LABEL: Record<ActionKind, string> = {
  dismiss: 'Dismissed',
  remove_content: 'Content removed',
  warn: 'Warning',
  mute: 'Muted',
  suspend: 'Suspended',
  ban: 'Account closed',
};

export type ReportGroup = {
  target_kind: string;
  target_id: string;
  institution: string;
  /** 1: ragging, threats, self-harm, leaked exams (2-hour target). */
  priority: number;
  categories: string[];
  reports: number;
  first_at: string;
  due_at: string;
  details: string[];
  snapshot: Record<string, unknown>;
  subject: {
    user_id: string;
    name: string;
    avatar_path: string | null;
    status: string;
    strikes: number;
    muted_until: string | null;
    staff: boolean;
  } | null;
};

export const loadReportsQueue = () => result<ReportGroup[]>(supabase.rpc('reports_queue'));

export type TakeAction = {
  action: ActionKind;
  userId?: string | null;
  reason?: string;
  days?: number;
  targetKind?: string;
  targetId?: string;
  remove?: boolean;
};

export const takeAction = (a: TakeAction) =>
  result<{ action_id: string; strikes: number; suggest_suspend: boolean }>(
    supabase.rpc('take_action', {
      p_action: a.action,
      p_user_id: a.userId ?? undefined,
      p_reason: a.reason,
      p_days: a.days,
      p_target_kind: a.targetKind,
      p_target_id: a.targetId,
      p_remove: a.remove ?? false,
    }),
  );

export type StandingAction = {
  id: string;
  action: ActionKind;
  reason: string;
  created_at: string;
  expires_at: string | null;
  revoked: boolean;
  appeal: { status: 'open' | 'upheld' | 'overturned'; created_at: string; note: string | null } | null;
  can_appeal: boolean;
};

export type Standing = {
  status: string;
  muted_until: string | null;
  suspended_until: string | null;
  strikes: number;
  actions: StandingAction[];
};

export const loadStanding = () => result<Standing>(supabase.rpc('my_standing'));
export const sendAppeal = (actionId: string, statement: string) =>
  result<string>(supabase.rpc('appeal', { p_action_id: actionId, p_statement: statement }));

export type QueuedAppeal = {
  id: string;
  statement: string;
  created_at: string;
  action: {
    id: string;
    action: ActionKind;
    reason: string;
    created_at: string;
    expires_at: string | null;
    target_kind: string | null;
  };
  moderator: string | null;
  subject: { user_id: string; name: string; strikes: number } | null;
  snapshot: Record<string, unknown> | null;
};

export const loadAppealsQueue = () => result<QueuedAppeal[]>(supabase.rpc('appeals_queue'));
export const decideAppeal = (id: string, decision: 'upheld' | 'overturned', note: string) =>
  result<null>(supabase.rpc('decide_appeal', { p_appeal_id: id, p_decision: decision, p_note: note.trim() || undefined }));

/** What was reported, as text a moderator can read: the post, message, comment or listing. */
export function snapshotText(kind: string, snapshot: Record<string, unknown> | null): { main: string; context: string[] } {
  if (!snapshot) return { main: '', context: [] };
  const s = snapshot as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (kind === 'message') {
    const context = Array.isArray(s.context) ? s.context.map((m: { body?: string }) => m.body ?? '').filter(Boolean) : [];
    return { main: s.message?.body || '(a photo, file or voice note)', context };
  }
  if (kind === 'conversation') {
    const recent = Array.isArray(s.recent) ? s.recent.map((m: { body?: string }) => m.body ?? '').filter(Boolean) : [];
    return { main: `Group: ${s.conversation?.title ?? 'a chat'}`, context: recent.slice(-8) };
  }
  if (kind === 'profile') return { main: `Profile: ${s.full_name ?? ''}`, context: [] };
  if (kind === 'post_comment') return { main: s.body ?? '', context: s.post?.body ? [`On the post: ${s.post.body}`] : [] };
  if (kind === 'fresher_answer') return { main: s.body ?? '', context: s.question?.body ? [`Question: ${s.question.body}`] : [] };
  if (kind === 'comment') return { main: s.comment?.body ?? '', context: [] };
  const main = s.body || s.title || s.topic || s.name || '';
  return { main: String(main), context: [] };
}

export const KIND_LABEL: Record<string, string> = {
  post: 'Post',
  post_comment: 'Comment on a post',
  message: 'Message',
  conversation: 'Chat',
  profile: 'Profile',
  listing: 'Shop listing',
  resource: 'Shared file',
  comment: 'Comment on a file',
  kuppi: 'Kuppi',
  kuppi_request: 'Kuppi request',
  fresher_question: "Freshers' question",
  fresher_answer: 'Answer to a fresher',
};

/** Content a moderator can remove from the queue (the rest from its own screen). */
export const REMOVABLE = new Set([
  'post',
  'post_comment',
  'message',
  'fresher_question',
  'fresher_answer',
  'comment',
  'resource',
  'listing',
]);

// The report a moderator opened from the queue, handed to the report screen without squeezing the
// evidence into the URL.
let opened: ReportGroup | null = null;
export function openReport(group: ReportGroup) {
  opened = group;
}
export const openedReport = () => opened;
onSignOut(() => {
  opened = null;
});
