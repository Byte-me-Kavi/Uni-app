import type * as DocumentPickerModule from 'expo-document-picker';
import type * as FileSystemModule from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { fileSize, openFile, putFile } from '@/lib/chat/transfer';
import { hasNative, UPDATE_APP } from '@/lib/native';
import { supabase } from '@/lib/supabase';

// Fresher accounts: the selection letter (picked, uploaded and checked through the letters
// function, to its own private bucket), where the application stands, the university email that
// makes a fresher a student, and the national admins' side (queue, letter, decision).

export type FresherStatus = 'needs_letter' | 'waiting' | 'approved' | 'rejected' | 'verified' | 'expired';

export type MyFresher = {
  status: FresherStatus;
  has_letter: boolean;
  /** Why the letter must be uploaded again, or why the account was not approved. */
  reason: string | null;
  submitted_at: string | null;
  fresher_until: string | null;
  email: string;
  institution: { id: number; name: string; short_name: string | null } | null;
  /** The university's email domains, to show what the university email looks like. */
  domains: string[];
};

type Result<T> = { data: T; error: null } | { data: null; error: string };

async function result<T>(call: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Result<T>> {
  const { data, error } = await call;
  if (error) return { data: null, error: error.message };
  return { data: data as T, error: null };
}

async function functionError(error: unknown, fallback: string) {
  const response = (error as { context?: Response }).context;
  const body = response && typeof response.json === 'function' ? await response.json().catch(() => null) : null;
  return (body?.error as string | undefined) ?? fallback;
}

export const loadMyFresher = () => result<MyFresher | null>(supabase.rpc('my_fresher'));

// ---------------------------------------------------------------------------------------------
// The letter
// ---------------------------------------------------------------------------------------------

export type LetterFile = { uri: string; mime: 'image/jpeg' | 'application/pdf'; name: string; size: number };

const MAX_BYTES = 10_000_000;

/** A photo (camera or gallery), re-encoded so the small print stays readable and the location
 * data in the original is dropped; or a PDF as it is. Null when the student cancels. */
export async function pickLetter(source: 'camera' | 'photos' | 'pdf'): Promise<LetterFile | { error: string } | null> {
  if (!hasNative('ExponentFileSystem')) return { error: UPDATE_APP };
  if (source === 'pdf') {
    if (!hasNative('ExpoDocumentPicker')) return { error: UPDATE_APP };
    const DocumentPicker = require('expo-document-picker') as typeof DocumentPickerModule;
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets[0]) return null;
    const asset = picked.assets[0];
    const size = asset.size ?? (await fileSize(asset.uri));
    if (!asset.name.toLowerCase().endsWith('.pdf') && asset.mimeType !== 'application/pdf')
      return { error: 'Choose a PDF file.' };
    if (size > MAX_BYTES) return { error: 'That PDF is over 10 MB. Take a photo of the letter instead.' };
    if (size === 0) return { error: 'That file is empty.' };
    return { uri: asset.uri, mime: 'application/pdf', name: asset.name.slice(0, 120), size };
  }

  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { error: 'Allow camera access in your phone settings to photograph the letter.' };
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  const picked =
    source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (picked.canceled || !picked.assets[0]) return null;
  const asset = picked.assets[0];
  // 2400 px on the long side keeps the letter's small print sharp.
  const context = ImageManipulator.manipulate(asset.uri);
  const scale = Math.min(1, 2400 / Math.max(asset.width, asset.height));
  if (scale < 1) context.resize({ width: Math.round(asset.width * scale) });
  const image = await (await context.renderAsync()).saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
  const size = await fileSize(image.uri);
  if (size <= 0 || size > MAX_BYTES) return { error: 'That photo could not be prepared. Try again.' };
  return { uri: image.uri, mime: 'image/jpeg', name: 'letter.jpg', size };
}

/** Uploads the letter and has it checked. On success the application is waiting for an admin. */
export async function uploadLetter(file: LetterFile, onProgress: (share: number) => void = () => {}): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('letters', {
    body: { action: 'sign', mime: file.mime, size: file.size },
    timeout: 20_000,
  });
  if (error) return functionError(error, 'The upload could not start. Check your connection.');
  const signed = data as { path: string; url: string; headers: Record<string, string> };
  const status = await putFile(signed.url, signed.headers, file.uri, onProgress);
  if (status < 200 || status >= 300) return 'The letter did not finish uploading. Check your connection and try again.';
  const check = await supabase.functions.invoke('letters', { body: { action: 'commit', path: signed.path }, timeout: 30_000 });
  if (check.error) return functionError(check.error, 'The letter could not be checked. Try again.');
  return null;
}

// ---------------------------------------------------------------------------------------------
// Becoming a student
// ---------------------------------------------------------------------------------------------

/** Checks the university email belongs to the fresher's university and is free, then asks
 * Supabase to change the login email: codes go to both the current and the new email. */
export async function startEmailChange(email: string): Promise<string | null> {
  const address = email.trim().toLowerCase();
  const check = await supabase.rpc('check_university_email', { p_email: address });
  if (check.error) return check.error.message;
  const { error } = await supabase.auth.updateUser({ email: address });
  if (!error) return null;
  if (error.code === 'email_exists') return 'That email already has a Uni Era account. Contact the Uni Era team if it is yours.';
  if (error.code === 'over_email_send_rate_limit') return 'Too many codes sent. Wait a minute and try again.';
  return error.message || 'Could not send the codes. Try again.';
}

/** Confirms one of the two codes (one sent to each email). */
export async function confirmEmailCode(email: string, code: string): Promise<string | null> {
  const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: 'email_change' });
  if (!error) return null;
  if (error.code === 'otp_expired') return 'That code is wrong or has expired. Request new codes.';
  return error.message || 'Could not confirm that code.';
}

// ---------------------------------------------------------------------------------------------
// National admins
// ---------------------------------------------------------------------------------------------

export type QueuedFresher = {
  user_id: string;
  email: string;
  submitted_at: string;
  registered_at: string;
  mime: 'image/jpeg' | 'application/pdf';
  size: number;
  /** Other accounts that uploaded the very same file. */
  same_file: number;
};

export const loadFresherQueue = () => result<QueuedFresher[]>(supabase.rpc('fresher_queue'));

/** A 5-minute link to the letter (each view is audited). */
export async function letterLink(userId: string): Promise<{ url: string; mime: string } | { error: string }> {
  const { data, error } = await supabase.functions.invoke('letters', {
    body: { action: 'view', user_id: userId },
    timeout: 20_000,
  });
  if (error) return { error: await functionError(error, 'Could not open the letter. Check your connection.') };
  return data as { url: string; mime: string };
}

function fs() {
  if (!hasNative('ExponentFileSystem')) throw new Error(UPDATE_APP);
  return require('expo-file-system/legacy') as typeof FileSystemModule;
}
const LETTER_DIR = () => `${fs().cacheDirectory}letters/`;

/** Opens a PDF letter in the phone's PDF viewer from a temporary copy, deleted by forgetLetters. */
export async function openLetterPdf(url: string, userId: string): Promise<string | null> {
  try {
    const FileSystem = fs();
    await FileSystem.makeDirectoryAsync(LETTER_DIR(), { intermediates: true }).catch(() => {});
    const target = `${LETTER_DIR()}${userId}.pdf`;
    const download = await FileSystem.downloadAsync(url, target);
    if (download.status !== 200) return 'Could not open the letter. Try again.';
    await openFile({ url, path: target, name: 'Selection letter.pdf', mime: 'application/pdf', localUri: target });
    return null;
  } catch (e) {
    return e instanceof Error && e.message ? e.message : 'Could not open the letter.';
  }
}

/** Deletes every letter copied to this phone for viewing. Called when the review screen closes. */
export function forgetLetters() {
  if (!hasNative('ExponentFileSystem')) return;
  fs()
    .deleteAsync(LETTER_DIR(), { idempotent: true })
    .catch(() => {});
}

export type Institution = { id: number; name: string; short_name: string | null };
export type Programme = { id: number; name: string };

export const loadLiveUniversities = () => result<Institution[]>(supabase.rpc('admin_programmes', {}));
export const searchProgrammes = (institutionId: number, query: string) =>
  result<Programme[]>(supabase.rpc('admin_programmes', { p_institution_id: institutionId, p_query: query }));

export type FresherDecision =
  | {
      decision: 'approved';
      institutionId: number;
      programmeId: number | null;
      programmeName: string | null;
      intakeYear: number;
      letterNumber: string;
    }
  | { decision: 'reupload' | 'rejected'; reason: string };

export function reviewFresher(userId: string, d: FresherDecision) {
  return result<{ status: string; batch?: string }>(
    supabase.rpc(
      'review_fresher',
      d.decision === 'approved'
        ? {
            p_user_id: userId,
            p_decision: 'approved',
            p_institution_id: d.institutionId,
            p_programme_id: d.programmeId ?? undefined,
            p_programme_name: d.programmeName ?? undefined,
            p_intake_year: d.intakeYear,
            p_letter_number: d.letterNumber.trim() || undefined,
          }
        : { p_user_id: userId, p_decision: d.decision, p_reason: d.reason },
    ),
  );
}

export type FresherBatch = { id: number; name: string; intake_year: number; members: number; freshers: number };
export const loadFresherBatches = () => result<FresherBatch[]>(supabase.rpc('fresher_batches'));
export const startBatch = (id: number) => result<null>(supabase.rpc('start_batch', { p_cohort_id: id }));

// ---------------------------------------------------------------------------------------------
// Freshers' questions
// ---------------------------------------------------------------------------------------------

export type QuestionsRole = 'fresher' | 'ambassador' | 'staff';

export type FresherQuestion = {
  id: number;
  body: string;
  /** The asker's programme, shown instead of their name. */
  programme: string | null;
  answer_count: number;
  created_at: string;
  answered_at: string | null;
  mine: boolean;
  /** Moderators only: who asked. */
  asker: string | null;
};

export type FresherAnswer = {
  id: number;
  body: string;
  created_at: string;
  mine: boolean;
  author: { name: string; avatar_path: string | null; role: 'Ambassador' | 'Uni Era team'; programme: string | null };
};

export type QuestionsPage = {
  role: QuestionsRole;
  university: string;
  waiting: FresherQuestion[];
  answered: FresherQuestion[];
};

export const loadFresherQuestions = (before?: string) =>
  result<QuestionsPage>(supabase.rpc('fresher_questions', before ? { p_before: before } : {}));
export const loadFresherQuestion = (id: number) =>
  result<FresherQuestion & { role: QuestionsRole; answers: FresherAnswer[] }>(supabase.rpc('fresher_question', { p_id: id }));
export const askFreshers = (body: string) => result<FresherQuestion>(supabase.rpc('ask_freshers', { p_body: body }));
export const answerFresher = (id: number, body: string) =>
  result<number>(supabase.rpc('answer_fresher', { p_question_id: id, p_body: body }));
export const deleteFresherItem = (kind: 'question' | 'answer', id: number) =>
  result<null>(supabase.rpc('delete_fresher_item', { p_kind: kind, p_id: id }));
export const setAmbassador = (userId: string, on: boolean) =>
  result<boolean>(supabase.rpc('set_ambassador', { p_user_id: userId, p_on: on }));
/** Null unless the student is a fresher, an ambassador or a moderator at their university. */
export const loadFreshersBadge = () => result<{ role: QuestionsRole; waiting: number } | null>(supabase.rpc('freshers_badge'));
