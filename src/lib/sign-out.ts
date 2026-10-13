import { Image } from 'expo-image';
import type * as FileSystemModule from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

import { clearCache } from '@/lib/cache';
import { stopChat } from '@/lib/chat/engine';
import { hasNative } from '@/lib/native';
import { setAppBadge, unregisterPush } from '@/lib/push';
import { runSignOutResets } from '@/lib/resets';
import { supabase } from '@/lib/supabase';

// Folders of this account's files: downloads kept for offline (documents), opened chat files, the
// selection letter and sticker imports (cache).
const DOCUMENT_FOLDERS = ['offline/'];
const CACHE_FOLDERS = ['chat-files/', 'letters/', 'sticker-import/'];

async function deleteFiles() {
  if (Platform.OS === 'web' || !hasNative('ExponentFileSystem')) return;
  const FileSystem = require('expo-file-system/legacy') as typeof FileSystemModule;
  const { documentDirectory: docs, cacheDirectory: cache } = FileSystem;
  const targets = [...(docs ? DOCUMENT_FOLDERS.map((f) => docs + f) : []), ...(cache ? CACHE_FOLDERS.map((f) => cache + f) : [])];
  // "Download your data" files, saved in the cache.
  if (cache) {
    const names = await FileSystem.readDirectoryAsync(cache).catch(() => [] as string[]);
    targets.push(...names.filter((n) => n.startsWith('uni-era-data-')).map((n) => cache + n));
  }
  await Promise.all(targets.map((t) => FileSystem.deleteAsync(t, { idempotent: true }).catch(() => {})));
}

/** Signs this phone out and leaves nothing of the account on it: notifications stop, the chat
 * database, downloaded files and cached photos are deleted, and every in-memory cache is cleared.
 * 'global' signs every phone out (deleting the account); otherwise other phones stay signed in.
 * Every sign-out button uses this. */
export async function signOut(scope: 'local' | 'global' = 'local') {
  const userId = (await supabase.auth.getSession()).data.session?.user.id ?? null;
  // Needs the session, so first.
  await unregisterPush().catch(() => undefined);
  setAppBadge(0);
  // The chat database must be closed before it can be deleted.
  await stopChat();
  if (userId && Platform.OS !== 'web') await SQLite.deleteDatabaseAsync(`chats-${userId}.db`).catch(() => {});
  await deleteFiles();
  await Image.clearDiskCache().catch(() => false);
  Image.clearMemoryCache().catch(() => false);
  clearCache();
  runSignOutResets();
  await supabase.auth.signOut({ scope });
}
