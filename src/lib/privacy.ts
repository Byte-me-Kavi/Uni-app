import { supabase } from '@/lib/supabase';

// Who sees what on a student's card, the consent centre and the batch directory.

type Result<T> = { data: T; error: null } | { data: null; error: string };

async function result<T>(call: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Result<T>> {
  const { data, error } = await call;
  if (error) return { data: null, error: error.message };
  return { data: data as T, error: null };
}

export type Level = 'everyone' | 'my_institution' | 'my_cohort' | 'nobody';
export type Field = 'photo' | 'bio' | 'batch';
export type Visibility = Record<Field, Level> & { directory: boolean };

export const LEVELS: { value: Level; label: string; detail: string }[] = [
  { value: 'everyone', label: 'Everyone', detail: 'Students at every university who can find you' },
  { value: 'my_institution', label: 'My university', detail: 'Only students at your university' },
  { value: 'my_cohort', label: 'My batch', detail: 'Only your batchmates' },
  { value: 'nobody', label: 'No one', detail: 'Only you' },
];

export const loadVisibility = () => result<Visibility>(supabase.rpc('profile_visibility'));
export const setVisibility = (field: Field, level: Level) =>
  result<Visibility>(supabase.rpc('set_field_visibility', { p_field: field, p_level: level }));

export type ConsentPurpose = {
  code: string;
  required: boolean;
  version: string;
  granted: boolean;
  decided: boolean;
  agreed_version: string | null;
  recorded_at: string | null;
};
export type Consents = { purposes: ConsentPurpose[]; needs_reconsent: boolean };

/** What each purpose means to a student, in plain words. */
export const PURPOSE_COPY: Record<string, { label: string; detail: string }> = {
  age_18_plus: { label: '18 or older', detail: 'You confirmed this when you signed up.' },
  community_guidelines: { label: 'Community guidelines', detail: 'The rules everyone on Uni Era follows.' },
  privacy_notice: { label: 'Privacy notice', detail: 'What we keep about you, why, and for how long.' },
  analytics: {
    label: 'Help improve Uni Era',
    detail: 'Count which screens and features are used, with a random id, never your name or messages.',
  },
  digest_email: { label: 'Weekly email', detail: 'A short email of what happened at your university this week.' },
  batch_directory: { label: 'Appear in my batch directory', detail: 'Batchmates can find you in a list of your batch.' },
};

export const loadConsents = () => result<Consents>(supabase.rpc('my_consents'));
export const setConsent = (code: string, granted: boolean, where: 'settings' | 'prompt' = 'settings') =>
  result<Consents>(supabase.rpc('set_consent', { p_code: code, p_granted: granted, p_where: where }));
export const acceptPolicies = () => result<Consents>(supabase.rpc('accept_policies'));

export type DirectoryPerson = { user_id: string; full_name: string; avatar_path: string | null; fresher: boolean; you: boolean };
export type Directory = { batch: string; asked: boolean; listed: boolean; members: number; people: DirectoryPerson[] };
export const loadDirectory = () => result<Directory>(supabase.rpc('batch_directory'));
