import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { useSyncExternalStore } from 'react';

import { readCache, writeCache } from '@/lib/cache';
import { putFile } from '@/lib/chat/transfer';
import { hasNative, UPDATE_APP } from '@/lib/native';
import { base64ToBytes, sha256 } from '@/lib/sha256';
import { supabase } from '@/lib/supabase';

// Each student's stickers: the ones they imported from WhatsApp or made from photos ("mine"),
// favourites, and recents. Uploaded stickers are public WebP files stored once per unique sticker
// (named by SHA-256), so a sticker shared by a thousand students is one file.
//
// WhatsApp import (Android): WhatsApp keeps every sticker you have received as a .webp file in
// Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Stickers. Android asks you once to let Uni Era
// read that folder; after that, new WhatsApp stickers are imported automatically (when the app
// opens, at most once a day, and when you open the sticker tray). iPhone keeps WhatsApp's files
// private to WhatsApp, so there you make stickers from photos instead.

export type LibrarySticker = { sticker: string; mine: boolean; favourite: boolean; used_at: string | null; animated: boolean };
type State = {
  items: LibrarySticker[];
  loaded: boolean;
  importing: { done: number; total: number } | null;
  whatsappLinked: boolean;
  lastImport: string | null;
  /** WhatsApp stickers found but not brought in yet (cancelled, or the daily limit was reached). */
  remaining: number;
};

// Where Android's folder picker opens. It must be a "document" address (a "tree" one is ignored
// and the picker opens at the top of the phone), so the student lands in the right folder and only
// has to tap "Use this folder", then "Allow".
const WHATSAPP_FOLDER =
  'content://com.android.externalstorage.documents/document/primary%3AAndroid%2Fmedia%2Fcom.whatsapp%2FWhatsApp%2FMedia%2FWhatsApp%20Stickers';
const AT_ONCE = 2; // stickers brought in side by side
const SAVE_EVERY = 24; // progress is written to the phone this often, not after every sticker

let cancelRequested = false;
let holdUntil = 0;

/** Stops a WhatsApp import after the stickers in flight; the rest wait for "Bring in the rest". */
export function cancelImport() {
  cancelRequested = true;
}

/** Pauses the import briefly so the phone gives its full attention to what you are doing (opening
 * a chat). An import of thousands of stickers runs on the same thread that draws the screen. */
export function holdStickerImport(ms = 1200) {
  holdUntil = Math.max(holdUntil, Date.now() + ms);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function whenFree() {
  while (Date.now() < holdUntil) await sleep(holdUntil - Date.now());
  await sleep(20); // a moment between stickers for taps and scrolling
}

// A file's name in WhatsApp's folder (STK-20251004-WA0012.webp): short to store, and sorts by date.
const fileName = (uri: string) => decodeURIComponent(uri).split('/').pop() ?? uri;

// SHA-256 on the phone's native code when the build has it; the JavaScript one otherwise.
async function fingerprint(bytes: Uint8Array) {
  if (hasNative('ExpoCrypto')) {
    const Crypto = require('expo-crypto') as typeof import('expo-crypto');
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as Uint8Array<ArrayBuffer>);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256(bytes);
}
const MAX_BYTES = 1_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

let user: string | null = null;
let state: State = { items: [], loaded: false, importing: null, whatsappLinked: false, lastImport: null, remaining: 0 };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const key = (name: string) => `${user}:stickers:${name}`;

export function useStickerLibrary<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
    () => select(state),
  );
}

export const canImportWhatsApp = Platform.OS === 'android';

/** Loads the signed-in student's stickers (the phone's copy first). */
export async function loadStickers(userId: string) {
  if (user !== userId) {
    user = userId;
    set({
      items: readCache<LibrarySticker[]>(key('library')) ?? [],
      loaded: false,
      importing: null,
      whatsappLinked: !!readCache<string>(key('whatsapp-folder')),
      lastImport: readCache<string>(key('last-import')),
      remaining: readCache<number>(key('remaining')) ?? 0,
    });
  }
  const { data, error } = await supabase.rpc('my_stickers');
  if (error || user !== userId) return;
  set({ items: data as LibrarySticker[], loaded: true });
  writeCache(key('library'), data);
}

export function resetStickers() {
  user = null;
  cancelRequested = true;
  set({ items: [], loaded: false, importing: null, whatsappLinked: false, lastImport: null, remaining: 0 });
}

/** Adds to (or removes from) favourites. */
export async function setFavourite(sticker: string, favourite: boolean) {
  const before = state.items;
  const exists = before.some((s) => s.sticker === sticker);
  set({
    items: exists
      ? before.map((s) => (s.sticker === sticker ? { ...s, favourite } : s))
      : [{ sticker, mine: false, favourite, used_at: null, animated: false }, ...before],
  });
  const { error } = await supabase.rpc('save_sticker', { p_sticker: sticker, p_favourite: favourite });
  if (error) {
    set({ items: before });
    return error.message;
  }
  writeCache(key('library'), state.items);
  return null;
}

/** Removes one of your imported or made stickers from your library (the file stays for others). */
export async function removeMine(sticker: string) {
  const before = state.items;
  set({ items: before.map((s) => (s.sticker === sticker ? { ...s, mine: false, favourite: false } : s)).filter((s) => s.mine || s.favourite || s.used_at) });
  const { error } = await supabase.rpc('save_sticker', { p_sticker: sticker, p_mine: false, p_favourite: false });
  if (error) set({ items: before });
}

/** Moves a sticker to the front of Recent (the server records the same when it is sent). */
export function markUsed(sticker: string) {
  const now = new Date().toISOString();
  const exists = state.items.some((s) => s.sticker === sticker);
  set({
    items: exists
      ? state.items.map((s) => (s.sticker === sticker ? { ...s, used_at: now } : s))
      : [{ sticker, mine: false, favourite: false, used_at: now, animated: false }, ...state.items],
  });
}

// ---------------------------------------------------------------------------------------------
// Adding stickers
// ---------------------------------------------------------------------------------------------

type Added = { sticker: string } | { error: string; stop?: boolean };

// Fingerprints a WebP, uploads it unless it is already stored, and adds it to your stickers.
async function addWebp(localUri: string): Promise<Added> {
  const FileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
  const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
  const bytes = base64ToBytes(base64);
  const text = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length > MAX_BYTES || text(0, 4) !== 'RIFF' || text(8, 12) !== 'WEBP') return { error: 'Not a WebP sticker.' };
  const hash = await fingerprint(bytes);
  const head = text(0, Math.min(bytes.length, 4096));
  const animated = head.includes('ANIM') || head.includes('ANMF');

  const { data, error } = await supabase.functions.invoke('media', {
    body: { action: 'sticker_sign', hash, size: bytes.length, animated },
    timeout: 20_000,
  });
  if (error) {
    const status = (error as { context?: Response }).context?.status ?? 0;
    return { error: 'Could not add the sticker.', stop: status === 429 || status === 401 || status === 0 };
  }
  const signed = data as { exists: boolean; sticker?: string; url?: string; headers?: Record<string, string> };
  if (!signed.exists) {
    const status = await putFile(signed.url!, signed.headers!, localUri, () => {});
    if (status < 200 || status >= 300) return { error: 'The sticker did not upload.', stop: status === 0 };
    const commit = await supabase.functions.invoke('media', { body: { action: 'sticker_commit', hash }, timeout: 20_000 });
    if (commit.error) return { error: 'Could not add the sticker.' };
  }
  return { sticker: `user:${hash}` };
}

/** Makes a sticker from a photo: square crop, 512 px WebP (WhatsApp's sticker format). */
export async function makeStickerFromPhoto(): Promise<{ ok: string } | { error: string } | null> {
  if (!hasNative('ExponentFileSystem')) return { error: UPDATE_APP };
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
  if (picked.canceled || !picked.assets[0]) return null;
  const asset = picked.assets[0];
  const side = Math.min(asset.width, asset.height);
  const context = ImageManipulator.manipulate(asset.uri);
  if (asset.width !== asset.height && side > 0) {
    context.crop({ originX: (asset.width - side) / 2, originY: (asset.height - side) / 2, width: side, height: side });
  }
  context.resize({ width: 512, height: 512 });
  const rendered = await context.renderAsync();
  let image = await rendered.saveAsync({ format: SaveFormat.WEBP, compress: 0.8 });
  // WhatsApp keeps still stickers under 100 KB; so do we.
  const FileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
  const info = await FileSystem.getInfoAsync(image.uri);
  if (info.exists && info.size > 100_000) image = await rendered.saveAsync({ format: SaveFormat.WEBP, compress: 0.55 });
  const added = await addWebp(image.uri);
  if ('error' in added) return { error: added.error };
  await loadStickers(user!);
  return { ok: added.sticker };
}

/** First time: asks Android for the WhatsApp Stickers folder, then imports everything in it.
 * `onLinked` runs as soon as access is given, before the import, so the screen can show it. */
export async function linkWhatsApp(onLinked?: () => void): Promise<string | null> {
  if (!canImportWhatsApp) return 'Importing WhatsApp stickers works on Android.';
  if (!hasNative('ExponentFileSystem')) return UPDATE_APP;
  const FileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
  const result = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(WHATSAPP_FOLDER);
  if (!result.granted) return null;
  if (!decodeURIComponent(result.directoryUri).includes('Stickers')) {
    return 'Choose the "WhatsApp Stickers" folder (Android › media › com.whatsapp › WhatsApp › Media).';
  }
  writeCache(key('whatsapp-folder'), result.directoryUri);
  set({ whatsappLinked: true });
  onLinked?.();
  return importFromWhatsApp(true);
}

/** Imports stickers added to WhatsApp since last time, newest first. Quietly does nothing if not
 * linked yet, if it ran in the last day, or if the student cancelled one (unless forced: "Bring in
 * the rest" and "Check WhatsApp" force it). When forced, says what happened. */
export async function importFromWhatsApp(force = false): Promise<string | null> {
  const folder = user ? readCache<string>(key('whatsapp-folder')) : null;
  if (!folder || state.importing || !canImportWhatsApp || !hasNative('ExponentFileSystem')) return null;
  if (!force && readCache<boolean>(key('paused'))) return null;
  const last = readCache<string>(key('last-import'));
  if (!force && last && Date.now() - Date.parse(last) < DAY_MS) return null;
  writeCache(key('paused'), false);
  cancelRequested = false;
  const owner = user;

  const FileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
  let files: string[];
  set({ importing: { done: 0, total: 0 } }); // "looking" until the folder has been read
  try {
    files = await FileSystem.StorageAccessFramework.readDirectoryAsync(folder);
  } catch {
    // Access was taken back in Android's settings, or WhatsApp moved: ask again next time.
    writeCache(key('whatsapp-folder'), null);
    set({ whatsappLinked: false, importing: null });
    return 'Uni Era can no longer read your WhatsApp stickers. Link the folder again.';
  }
  // Earlier versions stored whole addresses; names are enough (and far smaller to keep).
  const done = new Set((readCache<string[]>(key('imported')) ?? []).map(fileName));
  const fresh = files
    .filter((uri) => fileName(uri).toLowerCase().endsWith('.webp') && !done.has(fileName(uri)))
    .sort((a, b) => (fileName(a) < fileName(b) ? 1 : -1)); // newest first
  set({ importing: { done: 0, total: fresh.length } });
  const dir = `${FileSystem.cacheDirectory}sticker-import/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});

  let limited = false;
  let added = 0;
  let finished = 0;
  let sinceSave = 0;
  let arrived: LibrarySticker[] = [];
  // New stickers appear in "My stickers" as they arrive, a few at a time.
  const show = () => {
    if (!arrived.length || user !== owner) return;
    const known = new Set(state.items.map((i) => i.sticker));
    set({ items: [...arrived.filter((a) => !known.has(a.sticker)), ...state.items] });
    arrived = [];
  };
  // One sticker: copied out of WhatsApp's folder, fingerprinted, uploaded unless already stored.
  const bringIn = async (uri: string, slot: number) => {
    const target = `${dir}${slot}.webp`;
    try {
      await FileSystem.copyAsync({ from: uri, to: target });
      const result = await addWebp(target);
      if ('error' in result && result.stop) {
        limited = true;
        return;
      }
      if (!('error' in result)) {
        added++;
        arrived.push({ sticker: result.sticker, mine: true, favourite: false, used_at: null, animated: false });
      }
      done.add(fileName(uri)); // also files that are not stickers, so they are not tried again
    } catch {
      done.add(fileName(uri));
    } finally {
      await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
      finished++;
      sinceSave++;
      if (user === owner) set({ importing: { done: finished, total: fresh.length } });
    }
  };
  for (let i = 0; i < fresh.length; i += AT_ONCE) {
    if (cancelRequested || limited || user !== owner) break;
    await whenFree();
    await Promise.all(fresh.slice(i, i + AT_ONCE).map((uri, j) => bringIn(uri, j)));
    if (sinceSave >= SAVE_EVERY) {
      sinceSave = 0;
      writeCache(key('imported'), [...done]);
      show();
    }
  }
  if (user !== owner) return null; // signed out meanwhile
  show();
  writeCache(key('imported'), [...done]);
  const remaining = fresh.filter((uri) => !done.has(fileName(uri))).length;
  writeCache(key('remaining'), remaining);
  const cancelled = cancelRequested && remaining > 0;
  if (cancelled) writeCache(key('paused'), true); // no automatic import until asked again
  cancelRequested = false;

  let message: string | null = null;
  const count = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'sticker' : 'stickers'}`;
  if (cancelled) message = `Stopped. Brought in ${count(added)}; ${count(remaining)} left in WhatsApp.`;
  else if (limited) message = `Brought in ${count(added)}. The other ${count(remaining)} will follow tomorrow.`;
  else if (force) message = added ? `Brought in ${count(added)} from WhatsApp.` : 'No new stickers in WhatsApp.';
  const now = new Date().toISOString();
  writeCache(key('last-import'), now);
  set({ importing: null, lastImport: now, remaining });
  await loadStickers(owner!);
  return message;
}
