import type * as ContactsModule from 'expo-contacts';
import type * as DocumentPickerModule from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { fileSize, putFile } from '@/lib/chat/transfer';
import type { Attachment, ContactAttachment, FileAttachment, ImageAttachment, MessageKind } from '@/lib/chat/types';
import { hasNative, UPDATE_APP } from '@/lib/native';
import { supabase } from '@/lib/supabase';

// Loaded on first use (see native.ts): an app build made before these existed must still start.
const loadContacts = () => require('expo-contacts') as typeof ContactsModule;
const loadDocumentPicker = () => require('expo-document-picker') as typeof DocumentPickerModule;

// Picking, preparing and uploading what students send besides text.

const PHOTO_LONG_SIDE = 1600; // sharp on phones, about 200 to 500 KB as JPEG
export const MAX_FILE_BYTES = 25_000_000;

// The documents students can send (the server allows the same list).
const DOCUMENTS: Record<string, { mime: string; label: string }> = {
  pdf: { mime: 'application/pdf', label: 'PDF' },
  doc: { mime: 'application/msword', label: 'Word' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word' },
  ppt: { mime: 'application/vnd.ms-powerpoint', label: 'PowerPoint' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'PowerPoint' },
  xls: { mime: 'application/vnd.ms-excel', label: 'Excel' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel' },
  txt: { mime: 'text/plain', label: 'Text' },
  zip: { mime: 'application/zip', label: 'Zip' },
};
const MIMES = new Set(Object.values(DOCUMENTS).map((d) => d.mime));

export function documentLabel(mime: string) {
  return Object.values(DOCUMENTS).find((d) => d.mime === mime)?.label ?? 'File';
}

export function formatBytes(bytes: number) {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
}

/** The chat list's line for a message (the server writes the same). */
export function previewText(kind: MessageKind, body: string | null, attachment: Attachment | null) {
  const a = attachment as Record<string, unknown> | null;
  const text =
    kind === 'image'
      ? body
        ? `Photo: ${body}`
        : 'Photo'
      : kind === 'file'
        ? `Document: ${String(a?.name ?? 'file')}`
        : kind === 'sticker'
          ? 'Sticker'
          : kind === 'poll'
            ? `Poll: ${String(a?.question ?? '')}`
            : kind === 'contact'
              ? `Contact: ${String(a?.name ?? '')}`
              : (body ?? '');
  return text.slice(0, 140);
}

type Picked<T> = { ok: T } | { error: string } | null; // null: cancelled

// ---------------------------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------------------------

export async function pickPhoto(source: 'library' | 'camera'): Promise<Picked<ImageAttachment>> {
  if (!hasNative('ExponentFileSystem')) return { error: UPDATE_APP };
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { error: 'Allow camera access in your phone settings to take a photo.' };
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  const picked =
    source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (picked.canceled || !picked.assets[0]) return null;
  return { ok: await preparePhoto(picked.assets[0].uri, picked.assets[0].width, picked.assets[0].height) };
}

// Shrinks to 1600 px on the long side as JPEG (re-encoding also drops EXIF data such as location),
// and makes a 24 px preview that travels inside the message, so the other phone shows a blurred
// version instantly while the photo downloads.
async function preparePhoto(uri: string, width: number, height: number): Promise<ImageAttachment> {
  const context = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > PHOTO_LONG_SIDE) {
    context.resize(width >= height ? { width: PHOTO_LONG_SIDE } : { height: PHOTO_LONG_SIDE });
  }
  const photo = await (await context.renderAsync()).saveAsync({ compress: 0.8, format: SaveFormat.JPEG });

  const preview = ImageManipulator.manipulate(photo.uri).resize({ width: 24 });
  const tiny = await (await preview.renderAsync()).saveAsync({ compress: 0.5, format: SaveFormat.JPEG, base64: true });
  const thumb = tiny.base64 && tiny.base64.length < 3900 ? `data:image/jpeg;base64,${tiny.base64}` : null;

  return { local_uri: photo.uri, width: photo.width, height: photo.height, size: await fileSize(photo.uri), thumb };
}

// ---------------------------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------------------------

export async function pickDocument(): Promise<Picked<FileAttachment>> {
  if (!hasNative('ExpoDocumentPicker', 'ExponentFileSystem')) return { error: UPDATE_APP };
  const DocumentPicker = loadDocumentPicker();
  const picked = await DocumentPicker.getDocumentAsync({ type: [...MIMES], copyToCacheDirectory: true, multiple: false });
  if (picked.canceled || !picked.assets[0]) return null;
  const asset = picked.assets[0];
  const extension = asset.name.split('.').pop()?.toLowerCase() ?? '';
  // Some phones report no type or a generic one; the extension decides then.
  const mime = asset.mimeType && MIMES.has(asset.mimeType) ? asset.mimeType : DOCUMENTS[extension]?.mime;
  if (!mime) return { error: 'You can send PDF, Word, PowerPoint, Excel, text and zip files.' };
  const size = asset.size ?? (await fileSize(asset.uri));
  if (size > MAX_FILE_BYTES) return { error: `That file is ${formatBytes(size)}. Files can be up to 25 MB.` };
  if (size === 0) return { error: 'That file is empty.' };
  return { ok: { local_uri: asset.uri, name: asset.name.slice(0, 200), size, mime } };
}

// ---------------------------------------------------------------------------------------------
// Phone contacts
// ---------------------------------------------------------------------------------------------

export const canPickPhoneContact = Platform.OS !== 'web';

/** The phone's own contact picker: only the contact chosen is shared with the app. */
export async function pickPhoneContact(): Promise<Picked<ContactAttachment>> {
  if (!hasNative('ExpoContactsNext')) return { error: UPDATE_APP };
  const { Contact, requestPermissionsAsync: requestContactsPermission } = loadContacts();
  const contact = await Contact.presentPicker();
  if (!contact) return null;
  // Some Android phones only let the app read the chosen contact's numbers with contacts access;
  // ask for it then, once, rather than up front.
  const read = async () => ({ fullName: await contact.getFullName(), list: await contact.getPhones() });
  let details: Awaited<ReturnType<typeof read>>;
  try {
    details = await read();
  } catch {
    if (!(await requestContactsPermission()).granted) return { error: 'Allow contacts access to share a phone contact.' };
    details = await read();
  }
  const name = (details.fullName || '').trim().slice(0, 100);
  const phones = details.list
    .map((p) => ({ label: (p.label ?? '').slice(0, 30), number: (p.number ?? '').replace(/[^+0-9 ()-]/g, '').trim() }))
    .filter((p) => p.number.length >= 3 && p.number.length <= 30)
    .slice(0, 5);
  if (!name || phones.length === 0) return { error: 'That contact has no phone number to share.' };
  return { ok: { type: 'phone', name, phones } };
}

/** Opens the phone's "new contact" form filled in, for a shared phone contact. */
export async function savePhoneContact(contact: Extract<ContactAttachment, { type: 'phone' }>) {
  if (!hasNative('ExpoContactsNext')) throw new Error(UPDATE_APP);
  const [givenName, ...rest] = contact.name.split(' ');
  await loadContacts().Contact.presentCreateForm({ givenName, familyName: rest.join(' ') || undefined, phones: contact.phones });
}

// ---------------------------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------------------------

type Signed = { url: string; path: string; headers: Record<string, string> };
export type UploadResult = { path: string } | { error: string; permanent: boolean };

// Signs and uploads one file. A refusal from the server (too large, not allowed in this chat) is
// permanent; a network failure is not, and the outbox tries again later. If R2 refuses the URL
// (it expired on a slow connection), it signs once more.
export async function uploadAttachment(
  conversationId: string,
  kind: 'image' | 'file',
  file: { local_uri: string; mime: string; size: number },
  onProgress: (share: number) => void,
): Promise<UploadResult> {
  for (let round = 0; round < 2; round++) {
    const { data, error } = await supabase.functions.invoke('media', {
      body: { action: 'sign', conversation_id: conversationId, kind, mime: file.mime, size: file.size },
      timeout: 20_000,
    });
    if (error) {
      const response = (error as { context?: Response }).context;
      const status = typeof response?.status === 'number' ? response.status : 0;
      const body = response && typeof response.json === 'function' ? await response.json().catch(() => null) : null;
      if (status >= 400 && status < 500 && status !== 429) {
        return { error: body?.error ?? 'This file cannot be sent.', permanent: true };
      }
      return { error: body?.error ?? 'Waiting for a connection.', permanent: false };
    }
    const signed = data as Signed;
    const status = await putFile(signed.url, signed.headers, file.local_uri, onProgress);
    if (status >= 200 && status < 300) return { path: signed.path };
    if (status !== 403) break;
  }
  return { error: 'The file did not upload. Waiting for a better connection.', permanent: false };
}
