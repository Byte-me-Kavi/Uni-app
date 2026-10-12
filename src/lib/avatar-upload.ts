import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/lib/supabase';

export type PhotoSource = 'library' | 'camera';

type Result = { status: 'done'; path: string | null } | { status: 'cancelled' } | { status: 'error'; message: string };
type Signed = { url: string; path: string; headers: Record<string, string> };

const SIZE = 512; // shown at 104 points at most; 512 px stays sharp on 3x screens
const ATTEMPTS = 3; // mobile networks drop requests; two quick retries cover most blips
const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 45_000; // about 150 KB, generous for a slow 3G connection

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Reads the error message our avatar function returns. Details go to the developer console; the
// student sees what to do.
async function functionError(step: string, error: unknown): Promise<string> {
  const response = (error as { context?: Response }).context;
  if (response && typeof response.json === 'function') {
    const body = await response.json().catch(() => null);
    if (body?.error) return body.error as string;
    if (__DEV__) console.warn(`[photo] ${step} failed with HTTP ${response.status}`);
  } else if (__DEV__) {
    console.warn(`[photo] ${step} failed`, error);
  }
  return 'Could not update your photo. Check your connection and try again.';
}

// Calls the avatar function. Retries when the network drops, the request times out or the server
// has a hiccup (5xx). A refusal (4xx: too large, too many uploads, not allowed) is final.
// Every action is safe to repeat: sign hands out a fresh path, commit and remove are idempotent.
async function callAvatar<T>(body: { action: string; [key: string]: unknown }): Promise<{ data: T } | { message: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await wait(attempt * 800);
    const { data, error } = await supabase.functions.invoke('avatar', { body, timeout: REQUEST_TIMEOUT_MS });
    if (!error) return { data: data as T };
    lastError = error;
    const status = (error as { context?: { status?: number } }).context?.status;
    if (typeof status === 'number' && status < 500) break;
  }
  return { message: await functionError(body.action, lastError) };
}

// PUTs the photo to R2 with the signed URL. 'refused' means R2 rejected the signature, usually
// because the 2-minute URL expired on a slow connection; the caller then signs again.
async function put(signed: Signed, body: ArrayBuffer): Promise<'ok' | 'refused' | 'failed'> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await wait(attempt * 800);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    try {
      // Bytes, not a Blob: Expo's fetch replaces Content-Type with a Blob's own type (often empty
      // for files), which breaks the signature. Bytes go out exactly as signed.
      const response = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body, signal: controller.signal });
      // 412: an earlier attempt with this same link already stored the photo.
      if (response.ok || response.status === 412) return 'ok';
      if (__DEV__) console.warn(`[photo] storage answered HTTP ${response.status}`, await response.text().catch(() => ''));
      if (response.status === 403) return 'refused';
      if (response.status < 500) return 'failed';
    } catch (error) {
      if (__DEV__) console.warn(`[photo] upload attempt ${attempt + 1} did not finish`, error);
    } finally {
      clearTimeout(timer);
    }
  }
  return 'failed';
}

// JPEG bytes from the manipulator's base64 output (a fresh array, so its buffer is exactly the
// photo). At about 100 KB the conversion takes a few milliseconds.
function base64ToBytes(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

// Choose or take a photo, crop it square, shrink it on the phone, upload it straight to R2 with
// a short-lived signed URL, then record it. Re-encoding drops EXIF data such as location.
export async function changePhoto(source: PhotoSource): Promise<Result> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      return { status: 'error', message: 'Allow camera access in your phone settings to take a photo.' };
    }
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 };
  const picked =
    source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (picked.canceled || !picked.assets[0]) return { status: 'cancelled' };
  const asset = picked.assets[0];

  // Square crop (the web picker does not crop), then shrink.
  const side = Math.min(asset.width, asset.height);
  const context = ImageManipulator.manipulate(asset.uri);
  if (asset.width !== asset.height && side > 0) {
    context.crop({ originX: (asset.width - side) / 2, originY: (asset.height - side) / 2, width: side, height: side });
  }
  context.resize({ width: Math.min(SIZE, side || SIZE) });
  const image = await (await context.renderAsync()).saveAsync({ compress: 0.82, format: SaveFormat.JPEG, base64: true });
  if (!image.base64) return { status: 'error', message: 'Could not read that photo. Try another one.' };
  const bytes = base64ToBytes(image.base64);

  // Sign and upload; if R2 refuses the URL (expired on a slow network), sign once more.
  let signed: Signed | null = null;
  for (let round = 0; round < 2; round++) {
    const sign = await callAvatar<Signed>({ action: 'sign', size: bytes.byteLength });
    if ('message' in sign) return { status: 'error', message: sign.message };
    const outcome = await put(sign.data, bytes);
    if (outcome === 'ok') {
      signed = sign.data;
      break;
    }
    if (outcome === 'failed') break;
  }
  if (!signed) return { status: 'error', message: 'The photo did not upload. Check your connection and try again.' };

  const commit = await callAvatar<{ avatar_path: string }>({ action: 'commit', path: signed.path });
  if ('message' in commit) return { status: 'error', message: commit.message };
  return { status: 'done', path: signed.path };
}

export async function removePhoto(): Promise<Result> {
  const remove = await callAvatar<{ avatar_path: null }>({ action: 'remove' });
  if ('message' in remove) return { status: 'error', message: remove.message };
  return { status: 'done', path: null };
}
