import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type * as DocumentPickerModule from 'expo-document-picker';

import { readCache, writeCache } from '@/lib/cache';
import { signedUrl } from '@/lib/chat/media-urls';
import { fileSize, openFile, putFile } from '@/lib/chat/transfer';
import { dayMonth, weekdayDayMonth } from '@/lib/dates';
import { hasNative, UPDATE_APP } from '@/lib/native';
import { supabase } from '@/lib/supabase';

// The shop (see the shop migrations). Merch: batch reps (and merch leads, for a club or society)
// publish, students pre-order with their phone number and payment slip, the reps or leads confirm. Items: students sell to students and meet in
// person; nothing is paid through the app. Either can be opened to every university.

export type ListingKind = 'merch' | 'item';
export type Category = 'merch' | 'calculator' | 'laptop' | 'phone' | 'book' | 'lab' | 'electronics' | 'other';
export type Condition = 'new' | 'like_new' | 'good' | 'fair';
export type OrderStatus = 'placed' | 'paid' | 'rejected' | 'collected';
export type OrderLine = { size: string | null; quantity: number };
/** Merch: 'batch', 'university' or 'everyone'. Items: 'university' or 'everyone'. */
export type Audience = 'batch' | 'university' | 'everyone';

export type ListingCard = {
  id: string;
  kind: ListingKind;
  title: string;
  price: number;
  category: Category;
  condition: Condition | null;
  photo: string;
  status: 'open' | 'closed' | 'sold' | 'removed' | 'hidden';
  audience: Audience;
  /** Merch still taking orders. */
  ordering: boolean;
  closes_at: string | null;
  expires_at: string | null;
  created_at: string;
  mine: boolean;
  batch: string | null;
  /** Merch from a club or society (published by its merch leads). */
  club: string | null;
  /** The seller's university, short name. */
  institution: string | null;
  /** Listed at another university (opened to everyone). */
  other: boolean;
  seller: { id: string; name: string; avatar_path: string | null };
  my_order: { id: string; status: OrderStatus; quantity: number } | null;
  /** My listings only. */
  orders?: number;
  to_check?: number;
};

export type MyOrder = {
  id: string;
  lines: OrderLine[];
  quantity: number;
  total: number;
  phone: string;
  note: string | null;
  slip_path: string | null;
  status: OrderStatus;
  status_note: string | null;
  checked_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Listing = Omit<ListingCard, 'my_order'> & {
  description: string | null;
  photos: string[];
  size_chart: string | null;
  sizes: string[];
  payment_details: string | null;
  collect_details: string | null;
  needs_slip: boolean;
  contact_phone: string | null;
  can_manage: boolean;
  has_orders: boolean;
  orders: { count: number; to_check: number; quantity: number } | null;
  my_order: MyOrder | null;
  my_phone: string | null;
  /** Items: the caller said they are interested. */
  interested: boolean;
  /** Items, for the seller: who is interested, newest first. */
  interests: { id: string; name: string; avatar_path: string | null; batch: string | null; at: string }[] | null;
};

export type RepOrder = MyOrder & {
  buyer: { id: string; name: string; avatar_path: string | null; email: string; batch: string | null };
};

export type ListingOrders = {
  listing: ListingCard;
  orders: RepOrder[];
  sizes: { size: string | null; quantity: number; paid: number | null }[];
  totals: { orders: number; quantity: number; to_check: number; paid: number; expected: number };
};

export type OrderWithListing = MyOrder & {
  listing: {
    id: string;
    title: string;
    photo: string;
    status: ListingCard['status'];
    closes_at: string | null;
    collect_details: string | null;
    batch: string | null;
  };
};

export const CATEGORIES: { key: Exclude<Category, 'merch'>; label: string }[] = [
  { key: 'calculator', label: 'Calculators' },
  { key: 'laptop', label: 'Laptops' },
  { key: 'phone', label: 'Phones and tablets' },
  { key: 'book', label: 'Books' },
  { key: 'lab', label: 'Lab coats and tools' },
  { key: 'electronics', label: 'Electronics' },
  { key: 'other', label: 'Other' },
];

export const CONDITIONS: { key: Condition; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'like_new', label: 'Like new' },
  { key: 'good', label: 'Good' },
  { key: 'fair', label: 'Fair' },
];

export const conditionLabel = (c: Condition | null) => CONDITIONS.find((x) => x.key === c)?.label ?? '';

export const ORDER_STATUS: Record<OrderStatus, string> = {
  placed: 'Waiting for a rep to check',
  paid: 'Payment confirmed',
  rejected: 'Needs a fix',
  collected: 'Collected',
};

const RUPEES = new Intl.NumberFormat('en-US');
/** "Rs 1,800", "Free". */
export const price = (rupees: number) => (rupees === 0 ? 'Free' : `Rs ${RUPEES.format(rupees)}`);

/** "Orders close Fri 24 Oct". */
export const closesLabel = (iso: string | null) => (iso ? `Orders close ${weekdayDayMonth(iso)}` : '');

/** The card's small line: "Pre-order · closes 24 Oct", "Good · Calculators". */
export function cardLine(l: ListingCard) {
  if (l.kind === 'merch') {
    if (l.ordering) return `Pre-order · closes ${dayMonth(l.closes_at!)}`;
    return 'Orders closed';
  }
  if (l.status === 'sold') return 'Sold';
  return [conditionLabel(l.condition), CATEGORIES.find((c) => c.key === l.category)?.label].filter(Boolean).join(' · ');
}

/** "2 × M, 1 × L", or "3" when there are no sizes. */
export const linesLabel = (lines: OrderLine[]) =>
  lines.map((l) => (l.size ? `${l.quantity} × ${l.size}` : `${l.quantity}`)).join(', ');

type Result<T> = { data: T; error: null } | { data: null; error: string };

async function result<T>(call: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Result<T>> {
  const { data, error } = await call;
  if (error || data == null) return { data: null, error: error?.message ?? 'Something went wrong. Try again.' };
  return { data: data as T, error: null };
}

// ---------------------------------------------------------------------------------------------
// Browsing
// ---------------------------------------------------------------------------------------------

export type ShopFilter = 'all' | 'merch' | 'item';
/** 'mine': your university. 'others': other universities, what they opened to everyone. */
export type ShopScope = 'mine' | 'others';
export type Feed = {
  can_post_merch: boolean;
  /** A batch rep: publishes merch for the batch and chooses merch leads. */
  is_rep: boolean;
  /** The club or society the student publishes merch for, as its merch lead. */
  merch_club: string | null;
  listings: ListingCard[];
};

const FEED_CACHE = 'shop:feed';

/** The first page of the shop as it was last time, to show at once. */
export const cachedFeed = () => readCache<Feed>(FEED_CACHE);

export async function loadFeed(opts: {
  filter: ShopFilter;
  scope: ShopScope;
  category?: Category | null;
  query?: string;
  before?: string;
}) {
  const r = await result<Feed>(
    supabase.rpc('shop_feed', {
      p_filter: opts.filter,
      ...(opts.category ? { p_category: opts.category } : {}),
      ...(opts.query?.trim() ? { p_query: opts.query.trim() } : {}),
      ...(opts.before ? { p_before: opts.before } : {}),
      p_limit: 30,
      p_scope: opts.scope,
    }),
  );
  if (r.data && opts.scope === 'mine' && opts.filter === 'all' && !opts.category && !opts.query?.trim() && !opts.before)
    writeCache(FEED_CACHE, r.data);
  return r;
}

export const loadListing = (id: string) => result<Listing>(supabase.rpc('shop_listing', { p_listing_id: id }));
export const loadMyListings = () => result<ListingCard[]>(supabase.rpc('my_listings'));
export const loadMyOrders = () => result<OrderWithListing[]>(supabase.rpc('my_orders'));

// ---------------------------------------------------------------------------------------------
// Selling
// ---------------------------------------------------------------------------------------------

export type ListingDraft = {
  kind: ListingKind;
  /** New merch: for the rep's batch, or for the merch lead's club. */
  as?: 'batch' | 'club';
  title: string;
  description: string;
  price: number;
  photos: string[];
  // merch
  sizes?: string[];
  size_chart?: string | null;
  closes_at?: string;
  audience?: Audience;
  payment_details?: string;
  collect_details?: string;
  needs_slip?: boolean;
  // item
  category?: Category;
  condition?: Condition;
  contact_phone?: string;
};

export const saveListing = (id: string | null, draft: ListingDraft) =>
  result<Listing>(supabase.rpc('save_listing', { p_listing: draft, ...(id ? { p_listing_id: id } : {}) }));

// ---------------------------------------------------------------------------------------------
// Merch leads: students a batch rep lets publish merch for a club or society
// ---------------------------------------------------------------------------------------------

export type MerchLead = {
  user: { id: string; name: string; avatar_path: string | null; batch: string | null };
  club: string;
  appointed_by: string | null;
  /** Chosen by the caller (they can end it). */
  mine: boolean;
  created_at: string;
};
export type MerchLeads = { can_appoint: boolean; me: MerchLead | null; leads: MerchLead[] };

export const loadMerchLeads = () => result<MerchLeads>(supabase.rpc('merch_leads'));
export const appointMerchLead = (userId: string, club: string) =>
  result<MerchLeads>(supabase.rpc('appoint_merch_lead', { p_user_id: userId, p_club: club }));
export const removeMerchLead = (userId: string) => result<MerchLeads>(supabase.rpc('remove_merch_lead', { p_user_id: userId }));

/** "I'm interested" in an item: the seller is told and sees you in their list. */
export const listingInterest = (id: string) => result<Listing>(supabase.rpc('listing_interest', { p_listing_id: id }));

export const setListingStatus = (id: string, status: 'open' | 'closed' | 'sold' | 'removed' | 'renew') =>
  result<Listing>(supabase.rpc('set_listing_status', { p_listing_id: id, p_status: status }));

// ---------------------------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------------------------

export const placeOrder = (listingId: string, o: { lines: OrderLine[]; phone: string; note?: string; slip?: string | null }) =>
  result<Listing>(
    supabase.rpc('place_order', {
      p_listing_id: listingId,
      p_lines: o.lines,
      p_phone: o.phone,
      ...(o.note?.trim() ? { p_note: o.note.trim() } : {}),
      ...(o.slip ? { p_slip_path: o.slip } : {}),
    }),
  );

export const cancelOrder = (orderId: string) => result<Listing>(supabase.rpc('cancel_order', { p_order_id: orderId }));
export const loadListingOrders = (listingId: string) =>
  result<ListingOrders>(supabase.rpc('listing_orders', { p_listing_id: listingId }));
export const setOrderStatus = (orderId: string, status: OrderStatus, note?: string) =>
  result<ListingOrders>(
    supabase.rpc('set_order_status', { p_order_id: orderId, p_status: status, ...(note ? { p_note: note } : {}) }),
  );

/** The orders as a CSV table, for the reps' own sheet or the printer. */
export function ordersCsv(o: ListingOrders) {
  const cell = (v: string | number | null) => {
    const s = String(v ?? '');
    // A leading = + - @ would run as a formula in a spreadsheet.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = [
    ['Name', 'Batch', 'Email', 'Phone', 'Order', 'Quantity', 'Total (Rs)', 'Status', 'Note', 'Ordered'],
    ...o.orders.map((r) => [
      r.buyer.name,
      r.buyer.batch,
      r.buyer.email,
      r.phone,
      linesLabel(r.lines),
      r.quantity,
      r.total,
      ORDER_STATUS[r.status],
      r.note,
      new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' '),
    ]),
  ];
  return rows.map((row) => row.map(cell).join(',')).join('\n');
}

// ---------------------------------------------------------------------------------------------
// Photos, size charts and slips
// ---------------------------------------------------------------------------------------------

export type ShopUploadKind = 'photo' | 'chart' | 'slip';

/** A photo on a form: on the phone (uri) until it is uploaded (path). */
export type FormPhoto = {
  key: string;
  uri?: string;
  path?: string;
  /** A PDF slip (the bank app's receipt) instead of a photo. */
  pdf?: boolean;
  name?: string;
};

const PDF_MAX = 5_000_000;
/** A slip saved as a PDF (paths keep the extension the server gave them). */
export const isPdf = (path: string | null | undefined) => !!path && path.toLowerCase().endsWith('.pdf');

/** Chooses a PDF slip from the phone (up to 5 MB). Null when cancelled. */
export async function pickSlipPdf(): Promise<{ uri: string; name: string } | { error: string } | null> {
  if (!hasNative('ExpoDocumentPicker', 'ExponentFileSystem')) return { error: UPDATE_APP };
  const DocumentPicker = require('expo-document-picker') as typeof DocumentPickerModule;
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (picked.canceled || !picked.assets[0]) return null;
  const asset = picked.assets[0];
  const size = asset.size ?? (await fileSize(asset.uri));
  if (!asset.name.toLowerCase().endsWith('.pdf') && asset.mimeType !== 'application/pdf') return { error: 'Choose a PDF file.' };
  if (size > PDF_MAX) return { error: 'That PDF is over 5 MB. Take a screenshot of the receipt instead.' };
  if (size === 0) return { error: 'That file is empty.' };
  return { uri: asset.uri, name: asset.name.slice(0, 120) };
}

/** Opens a PDF slip in the phone's viewer: from the phone before upload, or from its signed link. */
export async function openSlip(file: { path?: string; uri?: string; name?: string }) {
  const url = file.uri ? '' : file.path ? await signedUrl(file.path) : null;
  if (url === null) return 'Could not open the slip. Check your connection.';
  try {
    await openFile({
      url,
      path: file.path ?? file.uri ?? 'slip.pdf',
      name: file.name ?? 'slip.pdf',
      mime: 'application/pdf',
      localUri: file.uri,
    });
    return null;
  } catch (e) {
    return e instanceof Error && e.message ? e.message : 'Could not open the slip.';
  }
}

// Listing photos are shrunk like chat photos; charts and slips stay sharper, so small print reads.
const LONG_SIDE: Record<ShopUploadKind, number> = { photo: 1600, chart: 2200, slip: 2200 };

async function prepare(kind: ShopUploadKind, asset: ImagePicker.ImagePickerAsset) {
  const context = ImageManipulator.manipulate(asset.uri);
  const long = LONG_SIDE[kind];
  if (Math.max(asset.width, asset.height) > long)
    context.resize(asset.width >= asset.height ? { width: long } : { height: long });
  // Re-encoding drops EXIF data such as location.
  const image = await (
    await context.renderAsync()
  ).saveAsync({ compress: kind === 'photo' ? 0.8 : 0.85, format: SaveFormat.JPEG });
  return image.uri;
}

/** Chooses photos (or takes one) and prepares them for upload. Null when cancelled. */
export async function pickShopPhotos(
  kind: ShopUploadKind,
  source: 'library' | 'camera',
  limit: number,
): Promise<{ uris: string[] } | { error: string } | null> {
  if (!hasNative('ExponentFileSystem')) return { error: UPDATE_APP };
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { error: 'Allow camera access in your phone settings to take a photo.' };
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 1,
    ...(source === 'library' && limit > 1
      ? { allowsMultipleSelection: true, selectionLimit: limit, orderedSelection: true }
      : {}),
  };
  const picked =
    source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (picked.canceled || picked.assets.length === 0) return null;
  const uris: string[] = [];
  for (const asset of picked.assets.slice(0, limit)) uris.push(await prepare(kind, asset));
  return { uris };
}

async function functionError(error: unknown, fallback: string) {
  const response = (error as { context?: Response }).context;
  const body = response && typeof response.json === 'function' ? await response.json().catch(() => null) : null;
  return (body?.error as string | undefined) ?? fallback;
}

/** Uploads one prepared photo (or a PDF slip) to the private bucket. Resolves with its path. A PDF
 * is checked by the server before an order can use it. */
export async function uploadShopPhoto(
  kind: ShopUploadKind,
  uri: string,
  pdf = false,
): Promise<{ path: string } | { error: string }> {
  const size = await fileSize(uri);
  if (size <= 0)
    return { error: pdf ? 'Could not read that PDF. Try another one.' : 'Could not read that photo. Try another one.' };
  if (size > (pdf ? PDF_MAX : 3_000_000))
    return { error: pdf ? 'That PDF is over 5 MB.' : 'That photo is too large. Try another one.' };
  // If R2 refuses the link (it expired on a slow connection), sign once more.
  for (let round = 0; round < 2; round++) {
    const { data, error } = await supabase.functions.invoke('media', {
      body: { action: 'shop_sign', kind, size, ...(pdf ? { mime: 'application/pdf' } : {}) },
      timeout: 20_000,
    });
    if (error) {
      const response = (error as { context?: Response }).context;
      const body = response && typeof response.json === 'function' ? await response.json().catch(() => null) : null;
      return { error: body?.error ?? 'The photo did not upload. Check your connection and try again.' };
    }
    const signed = data as { url: string; path: string; headers: Record<string, string> };
    const status = await putFile(signed.url, signed.headers, uri, () => {});
    if (status >= 200 && status < 300) {
      if (!pdf) return { path: signed.path };
      const check = await supabase.functions.invoke('media', {
        body: { action: 'shop_check', path: signed.path },
        timeout: 30_000,
      });
      if (check.error) return { error: await functionError(check.error, 'The PDF could not be checked. Try again.') };
      return { path: signed.path };
    }
    if (status !== 403) break;
  }
  return {
    error: pdf
      ? 'The PDF did not upload. Check your connection and try again.'
      : 'The photo did not upload. Check your connection and try again.',
  };
}

/** Uploads every photo on a form that is still only on the phone, in order. Paths come back in
 * the same order; photos already uploaded are kept (so a retry does not upload them again). */
export async function uploadAll(
  kind: ShopUploadKind,
  photos: FormPhoto[],
  onUploaded: (key: string, path: string) => void,
): Promise<{ paths: string[] } | { error: string }> {
  const paths: string[] = [];
  for (const p of photos) {
    if (p.path) {
      paths.push(p.path);
      continue;
    }
    if (!p.uri) continue;
    const r = await uploadShopPhoto(kind, p.uri, !!p.pdf);
    if ('error' in r) return r;
    onUploaded(p.key, r.path);
    paths.push(r.path);
  }
  return { paths };
}

/** Copies bank details or a phone number. False when this app build cannot. */
export async function copyText(text: string) {
  if (Platform.OS === 'web') {
    await navigator.clipboard?.writeText(text);
    return true;
  }
  if (!hasNative('ExpoClipboard')) return false;
  await (require('expo-clipboard') as typeof import('expo-clipboard')).setStringAsync(text);
  return true;
}
