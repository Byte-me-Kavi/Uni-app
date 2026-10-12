import type * as DocumentPickerModule from 'expo-document-picker';

import { formatBytes } from '@/lib/chat/attachments';
import { signedUrl } from '@/lib/chat/media-urls';
import { fileSize, offlineCopy, openFile, putFile } from '@/lib/chat/transfer';
import type { Category } from '@/lib/library';
import { hasNative, UPDATE_APP } from '@/lib/native';
import { supabase } from '@/lib/supabase';

// The shared library (Explore): files published to a module for the whole university. Publishing
// and uploading go through the `files` Edge Function, which checks every file before it goes live.

export type SharedCategory = Exclude<Category, 'videos' | 'links' | 'photos'>;

export const SHARED_CATEGORIES: { key: SharedCategory; label: string }[] = [
  { key: 'past_papers', label: 'Past papers' },
  { key: 'notes', label: 'Notes' },
  { key: 'slides', label: 'Lecture slides' },
  { key: 'tutorials', label: 'Tutorials and labs' },
  { key: 'assignments', label: 'Assignments' },
  { key: 'other', label: 'Other files' },
];

export type SharedFile = {
  id: string;
  title: string;
  category: SharedCategory;
  paper_year?: number;
  mime: string;
  size: number;
  key: string;
  status: 'pending' | 'live' | 'quarantined' | 'duplicate' | 'removed';
  /** 'national': shared with students at every university taking the subject. */
  scope: 'university' | 'national';
  comment_count: number;
  /** The uploader's university (shown for files from elsewhere). */
  institution?: string;
  /** Search: the line inside the file that matched. */
  snippet?: string;
  check_reason?: string;
  published_as: 'owner' | 'rep';
  created_at: string;
  mine: boolean;
  uploader_name?: string;
  module: { id: number; code: string; name: string };
};

export type ExploreOverview = { modules: { module_id: number; count: number }[]; mine: SharedFile[] };

export async function loadExploreOverview() {
  const { data, error } = await supabase.rpc('explore_overview');
  if (error || !data) return null;
  return data as ExploreOverview;
}

export async function exploreFiles(opts: {
  moduleId?: number;
  category?: SharedCategory | null;
  query?: string;
  before?: string;
  /** Files other universities shared with everyone (for a module: the same subject). */
  national?: boolean;
}) {
  const { data, error } = await supabase.rpc('explore', {
    ...(opts.national ? { p_national: true } : {}),
    ...(opts.moduleId ? { p_module_id: opts.moduleId } : {}),
    ...(opts.category ? { p_category: opts.category } : {}),
    ...(opts.query?.trim() ? { p_query: opts.query.trim() } : {}),
    ...(opts.before ? { p_before: opts.before } : {}),
    p_limit: 40,
  });
  if (error) return { files: null, error: error.message };
  return { files: (data ?? []) as SharedFile[], error: null };
}

/** The name a shared file is saved under on the phone. */
export const sharedFileName = (file: Pick<SharedFile, 'title' | 'key'>) => `${file.title}.${file.key.split('.').pop()}`;

export async function openShared(file: SharedFile) {
  try {
    const name = sharedFileName(file);
    const kept = await offlineCopy({ path: file.key, name });
    const url = kept ? '' : await signedUrl(file.key);
    if (!url && !kept) return 'Could not open. Check your connection and try again.';
    await openFile({ url: url ?? '', path: file.key, name, mime: file.mime });
    return null;
  } catch {
    return 'Could not open. Check your connection and try again.';
  }
}

export async function removeShared(id: string) {
  const { error } = await supabase.rpc('remove_resource', { p_resource_id: id });
  return error?.message ?? null;
}

type Verdict = { status: 'live' | 'quarantined' | 'duplicate' | 'pending'; reason: string | null };

/** The files function's answer, or its error message. */
async function callFiles(body: Record<string, unknown>, timeout = 60_000): Promise<{ data: unknown; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('files', { body, timeout });
  if (!error) return { data, error: null };
  const response = (error as { context?: Response }).context;
  const parsed = response && typeof response.json === 'function' ? await response.json().catch(() => null) : null;
  return { data: null, error: (parsed as { error?: string } | null)?.error ?? 'Could not reach Uni Era. Check your connection.' };
}

export type PublishInput = {
  moduleId: number;
  category: SharedCategory;
  title?: string;
  paperYear?: number | null;
  scope?: 'university' | 'national';
};

/** Shares a file from a chat with the university. The verdict says whether it went live. */
export async function publishFromChat(messageId: string, input: PublishInput) {
  const { data, error } = await callFiles({
    action: 'resource_publish',
    message_id: messageId,
    module_id: input.moduleId,
    category: input.category,
    ...(input.title ? { title: input.title } : {}),
    ...(input.paperYear ? { paper_year: input.paperYear } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
  });
  return { verdict: data as Verdict | null, error };
}

// The types Explore accepts (the server allows the same).
const SHAREABLE: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

export type PickedShare = { uri: string; name: string; mime: string; size: number };

export async function pickShareable(): Promise<{ ok: PickedShare } | { error: string } | null> {
  if (!hasNative('ExpoDocumentPicker', 'ExponentFileSystem')) return { error: UPDATE_APP };
  const DocumentPicker = require('expo-document-picker') as typeof DocumentPickerModule;
  const picked = await DocumentPicker.getDocumentAsync({ type: [...new Set(Object.values(SHAREABLE))], copyToCacheDirectory: true });
  if (picked.canceled || !picked.assets[0]) return null;
  const asset = picked.assets[0];
  const extension = asset.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = asset.mimeType && Object.values(SHAREABLE).includes(asset.mimeType) ? asset.mimeType : SHAREABLE[extension];
  if (!mime) return { error: 'You can share PDF, Word, PowerPoint and photos.' };
  const size = asset.size ?? (await fileSize(asset.uri));
  if (size > 25 * 1024 * 1024) return { error: `That file is ${formatBytes(size)}. Files can be up to 25 MB.` };
  if (size === 0) return { error: 'That file is empty.' };
  return { ok: { uri: asset.uri, name: asset.name, mime, size } };
}

/** Uploads a document from the phone to the shared library, then waits for its check. */
export async function uploadShared(file: PickedShare, input: PublishInput & { title: string }, onProgress: (share: number) => void) {
  const signed = await callFiles({
    action: 'resource_upload',
    module_id: input.moduleId,
    category: input.category,
    title: input.title,
    mime: file.mime,
    size: file.size,
    ...(input.paperYear ? { paper_year: input.paperYear } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
  }, 20_000);
  if (signed.error || !signed.data) return { verdict: null, error: signed.error };
  const { resource_id, url, headers } = signed.data as { resource_id: string; url: string; headers: Record<string, string> };
  const status = await putFile(url, headers, file.uri, onProgress);
  if (status < 200 || status >= 300) return { verdict: null, error: 'The upload did not finish. Check your connection and try again.' };
  const done = await callFiles({ action: 'resource_finish', resource_id });
  return { verdict: done.data as Verdict | null, error: done.error };
}

export function verdictText(v: Verdict | null) {
  if (!v) return null;
  if (v.status === 'live') return 'Shared with your university.';
  if (v.status === 'quarantined') return `Not shared: ${v.reason ?? 'the file did not pass its check.'}`;
  if (v.status === 'duplicate') return `Not shared again: ${v.reason ?? 'this file is already in Explore.'}`;
  return 'Shared. It shows once it has been checked.';
}

// ---------------------------------------------------------------------------------------------
// A shared file and its discussion
// ---------------------------------------------------------------------------------------------

export type SharedDetail = SharedFile & { can_moderate: boolean; questions: { question: string; count: number }[] };

export type Comment = {
  id: string;
  question?: string;
  body?: string;
  deleted: boolean;
  votes: number;
  voted: boolean;
  mine: boolean;
  created_at: string;
  edited: boolean;
  author?: { id: string; name: string; avatar_path: string | null };
  replies?: Comment[];
};

export async function loadShared(id: string) {
  const { data, error } = await supabase.rpc('resource', { p_resource_id: id });
  if (error || !data) return { file: null, error: error?.message ?? 'This file is not available.' };
  return { file: data as SharedDetail, error: null };
}

export async function loadComments(id: string, question: string | null) {
  const { data, error } = await supabase.rpc('comments', { p_resource_id: id, ...(question ? { p_question: question } : {}) });
  if (error) return { comments: null, error: error.message };
  return { comments: (data ?? []) as Comment[], error: null };
}

export async function addComment(id: string, body: string, question?: string | null, parentId?: string | null) {
  const { data, error } = await supabase.rpc('add_comment', {
    p_resource_id: id,
    p_body: body,
    ...(question ? { p_question: question } : {}),
    ...(parentId ? { p_parent_id: parentId } : {}),
  });
  if (error || !data) return { comment: null, error: error?.message ?? 'Could not post. Try again.' };
  return { comment: data as Comment, error: null };
}

export async function voteComment(id: string, on: boolean) {
  const { data, error } = await supabase.rpc('vote_comment', { p_comment_id: id, p_on: on });
  if (error || !data) return { comment: null, error: error?.message ?? 'Could not vote. Try again.' };
  return { comment: data as Comment, error: null };
}

export async function deleteComment(id: string) {
  const { error } = await supabase.rpc('delete_comment', { p_comment_id: id });
  return error?.message ?? null;
}

// ---------------------------------------------------------------------------------------------
// A module's national subject
// ---------------------------------------------------------------------------------------------

export type ModuleSubject = {
  subject: { id: number; name: string } | null;
  universities?: number;
  national_files?: number;
  can_edit?: boolean;
};

export async function loadModuleSubject(moduleId: number) {
  const { data } = await supabase.rpc('module_subject', { p_module_id: moduleId });
  return (data ?? null) as ModuleSubject | null;
}

export async function setModuleSubject(moduleId: number, name: string) {
  const { data, error } = await supabase.rpc('set_module_subject', { p_module_id: moduleId, p_subject: name });
  if (error || !data) return { subject: null, error: error?.message ?? 'Could not change it. Try again.' };
  return { subject: data as ModuleSubject, error: null };
}
