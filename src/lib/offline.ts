import type * as NetworkModule from 'expo-network';

import { forgetCache, readCache, writeCache } from '@/lib/cache';
import { signedUrl } from '@/lib/chat/media-urls';
import { dropOffline, keepOffline } from '@/lib/chat/transfer';
import type { ModuleFolder } from '@/lib/library';
import { hasNative } from '@/lib/native';
import { sharedFileName, type SharedFile } from '@/lib/shared';
import { supabase } from '@/lib/supabase';

// A whole module on the phone before exams: every document and photo in the student's library for
// it, and what their university shared for it. Kept in the documents folder (never cleared by the
// phone), opened without data. Downloads wait for Wi-Fi unless the student says otherwise.

export type OfflineFile = { path: string; name: string; size: number };
export type OfflinePack = { files: OfflineFile[]; saved_at: string };

const packKey = (userId: string, moduleId: number) => `${userId}:offline:${moduleId}`;

export function readPack(userId: string, moduleId: number) {
  return readCache<OfflinePack>(packKey(userId, moduleId));
}

/** true on Wi-Fi (or a cable), false on mobile data, null when the app cannot tell (older build). */
export async function onWifi(): Promise<boolean | null> {
  if (!hasNative('ExpoNetwork')) return null;
  const Network = require('expo-network') as typeof NetworkModule;
  const state = await Network.getNetworkStateAsync().catch(() => null);
  if (!state) return null;
  return state.type === Network.NetworkStateType.WIFI || state.type === Network.NetworkStateType.ETHERNET;
}

/** Every file of a module the student can keep: their library (all pages) and shared files. */
async function moduleFiles(moduleId: number) {
  const files = new Map<string, { path: string; name: string }>();
  let before: string | undefined;
  for (let page = 0; page < 20; page++) {
    const { data } = await supabase.rpc('library', { p_module_id: moduleId, p_limit: 100, ...(before ? { p_before: before } : {}) });
    const folder = data as ModuleFolder | null;
    if (!folder) break;
    for (const item of folder.items) if (item.path) files.set(item.path, { path: item.path, name: item.title });
    if (folder.items.length < 100) break;
    before = folder.items[folder.items.length - 1].created_at;
  }
  const { data: shared } = await supabase.rpc('explore', { p_module_id: moduleId, p_limit: 100 });
  for (const f of (shared ?? []) as SharedFile[]) files.set(f.key, { path: f.key, name: sharedFileName(f) });
  return [...files.values()];
}

/** Downloads a module for offline use, one file at a time. */
export async function downloadModule(userId: string, moduleId: number, onProgress: (done: number, total: number) => void) {
  const files = await moduleFiles(moduleId);
  const kept: OfflineFile[] = [];
  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    onProgress(i, files.length);
    try {
      const url = await signedUrl(files[i].path);
      if (!url) throw new Error('no link');
      kept.push({ ...files[i], size: await keepOffline({ url, ...files[i] }) });
    } catch {
      failed++;
    }
  }
  onProgress(files.length, files.length);
  const pack: OfflinePack = { files: kept, saved_at: new Date().toISOString() };
  writeCache(packKey(userId, moduleId), pack);
  return { pack, failed };
}

export async function removeModule(userId: string, moduleId: number) {
  const pack = readPack(userId, moduleId);
  for (const f of pack?.files ?? []) await dropOffline(f);
  forgetCache(packKey(userId, moduleId));
}
