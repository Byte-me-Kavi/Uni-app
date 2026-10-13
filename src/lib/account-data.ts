import type * as FileSystemModule from 'expo-file-system/legacy';
import type * as SharingModule from 'expo-sharing';

import { hasNative, UPDATE_APP } from '@/lib/native';
import { supabase } from '@/lib/supabase';

// Your data: download everything Uni Era keeps about you (one JSON file, made on the phone, saved
// wherever you choose; nothing is stored on a server for it), and delete your account (after 30
// days, which signing in can stop).

/** Builds the file and opens the share sheet to save it (Files, Drive, email to yourself). */
export async function downloadMyData(): Promise<string | null> {
  if (!hasNative('ExponentFileSystem', 'ExpoSharing')) return UPDATE_APP;
  const { data, error } = await supabase.rpc('export_my_data');
  if (error) return error.message;
  const FileSystem = require('expo-file-system/legacy') as typeof FileSystemModule;
  const Sharing = require('expo-sharing') as typeof SharingModule;
  const day = new Date().toISOString().slice(0, 10);
  const uri = `${FileSystem.cacheDirectory}uni-era-data-${day}.json`;
  try {
    await FileSystem.writeAsStringAsync(uri, JSON.stringify(data, null, 2));
    await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Save your Uni Era data', UTI: 'public.json' });
    return null;
  } catch {
    return 'Could not save the file. Try again.';
  } finally {
    // The share sheet has its own copy by now; nothing stays in the app's cache.
    FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}

/** Starts the 30 days. Resolves with the day the account will be deleted. */
export async function requestDeletion(email: string): Promise<{ at: string } | { error: string }> {
  const { data, error } = await supabase.rpc('request_deletion', { p_email: email });
  if (error) return { error: error.message };
  return { at: data as string };
}

export async function cancelDeletion(): Promise<string | null> {
  const { error } = await supabase.rpc('cancel_deletion');
  if (error) return error.message;
  await supabase.auth.refreshSession();
  return null;
}
