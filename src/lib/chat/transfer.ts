import type * as FileSystemModule from 'expo-file-system/legacy';
import type * as IntentLauncherModule from 'expo-intent-launcher';
import type * as SharingModule from 'expo-sharing';
import { Platform } from 'react-native';

import { hasNative, UPDATE_APP } from '@/lib/native';

// Moving chat files between the phone and R2. Uploads stream from disk (a 25 MB document is never
// held in memory) and report progress. Downloads are kept in the cache, so a document opens
// instantly the second time and works offline.
//
// The native modules load on first use, so an app build made before they existed still starts
// (see native.ts); uploading then waits, and opening a file says to update the app.
function fs() {
  if (!hasNative('ExponentFileSystem')) throw new Error(UPDATE_APP);
  return require('expo-file-system/legacy') as typeof FileSystemModule;
}
const sharing = () => {
  if (!hasNative('ExpoSharing')) throw new Error(UPDATE_APP);
  return require('expo-sharing') as typeof SharingModule;
};
const intents = () => (hasNative('ExpoIntentLauncher') ? (require('expo-intent-launcher') as typeof IntentLauncherModule) : null);

export async function fileSize(uri: string) {
  const info = await fs().getInfoAsync(uri);
  return info.exists ? info.size : 0;
}

export async function exists(uri: string | undefined) {
  if (!uri || !hasNative('ExponentFileSystem')) return false;
  return (await fs().getInfoAsync(uri).catch(() => ({ exists: false }))).exists;
}

/** PUTs a file to a signed URL. Resolves with the HTTP status (0 when the network failed). */
export async function putFile(url: string, headers: Record<string, string>, uri: string, onProgress: (share: number) => void) {
  if (!hasNative('ExponentFileSystem')) return 0;
  const FileSystem = fs();
  const task = FileSystem.createUploadTask(
    url,
    uri,
    { httpMethod: 'PUT', uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT, headers },
    ({ totalBytesSent, totalBytesExpectedToSend }) =>
      totalBytesExpectedToSend > 0 && onProgress(totalBytesSent / totalBytesExpectedToSend),
  );
  const result = await task.uploadAsync().catch(() => null);
  return result?.status ?? 0;
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) || 'file';

// Files kept for offline (a whole module before exams) live in the documents folder, which the
// phone never clears, unlike the cache.
const offlineTarget = (file: { path: string; name: string }) =>
  `${fs().documentDirectory}offline/${file.path.split('/').pop()?.split('.')[0] ?? 'file'}/${safeName(file.name)}`;

/** The offline copy of a file, if one was kept. */
export async function offlineCopy(file: { path: string; name: string }) {
  if (!hasNative('ExponentFileSystem')) return null;
  const target = offlineTarget(file);
  return (await exists(target)) ? target : null;
}

/** Keeps a file on the phone for offline use. Resolves with its size in bytes. */
export async function keepOffline(file: { url: string; path: string; name: string }) {
  const FileSystem = fs();
  const target = offlineTarget(file);
  const info = await FileSystem.getInfoAsync(target).catch(() => ({ exists: false }) as const);
  if (info.exists) return 'size' in info ? info.size : 0;
  await FileSystem.makeDirectoryAsync(target.slice(0, target.lastIndexOf('/') + 1), { intermediates: true }).catch(() => {});
  const result = await FileSystem.downloadAsync(file.url, target);
  if (result.status !== 200) {
    await FileSystem.deleteAsync(target, { idempotent: true });
    throw new Error(`download failed (${result.status})`);
  }
  return Number(result.headers['Content-Length'] ?? result.headers['content-length'] ?? 0);
}

/** Removes a file's offline copy. */
export async function dropOffline(file: { path: string; name: string }) {
  if (!hasNative('ExponentFileSystem')) return;
  const target = offlineTarget(file);
  await fs().deleteAsync(target.slice(0, target.lastIndexOf('/') + 1), { idempotent: true }).catch(() => {});
}

/** The file on the phone: your own sent copy, an offline copy, else a cached download. */
async function localCopy(file: { url: string; path: string; name: string; localUri?: string }) {
  if (await exists(file.localUri)) return file.localUri!;
  const kept = await offlineCopy(file);
  if (kept) return kept;
  const FileSystem = fs();
  const id = file.path.split('/').pop()?.split('.')[0] ?? 'file';
  const dir = `${FileSystem.cacheDirectory}chat-files/${id}/`;
  const target = dir + safeName(file.name);
  if (await exists(target)) return target;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const result = await FileSystem.downloadAsync(file.url, target);
  if (result.status !== 200) {
    await FileSystem.deleteAsync(target, { idempotent: true });
    throw new Error(`download failed (${result.status})`);
  }
  return target;
}

/** Opens a document in the phone's own viewer (PDF reader, Word and so on). */
export async function openFile(file: { url: string; path: string; name: string; mime: string; localUri?: string }) {
  const uri = await localCopy(file);
  const IntentLauncher = intents();
  if (Platform.OS === 'android' && IntentLauncher) {
    try {
      const contentUri = await fs().getContentUriAsync(uri);
      // FLAG_GRANT_READ_URI_PERMISSION, so the viewer app may read our cached copy.
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: contentUri, flags: 1, type: file.mime });
      return;
    } catch {
      // No app for this type: offer the share sheet instead.
    }
  }
  await sharing().shareAsync(uri, { mimeType: file.mime, dialogTitle: file.name });
}

/** Share or save a photo or document through the phone's share sheet. */
export async function shareFile(file: { url: string; path: string; name: string; mime: string; localUri?: string }) {
  const uri = await localCopy(file);
  await sharing().shareAsync(uri, { mimeType: file.mime, dialogTitle: file.name });
}
