import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import type * as NetworkModule from 'expo-network';
import { Linking } from 'react-native';

import { readCache, writeCache } from '@/lib/cache';
import { fileSize, putFile } from '@/lib/chat/transfer';
import { mediaUrl } from '@/lib/media';
import { hasNative, UPDATE_APP } from '@/lib/native';
import { supabase } from '@/lib/supabase';

// Ads on Home (see the home ads migration): sponsored slides after the "you're in your uni era"
// card. Admins create them in the app (Profile, Ads on Home); students see live ones for their
// university. Media lives in the public bucket, so slides load fast and cache.

export type AdSlide = {
  id: string;
  sponsor: string;
  headline: string | null;
  body: string | null;
  cta_label: string | null;
  link_url: string | null;
  media_kind: 'image' | 'video';
  media_path: string;
  poster_path: string | null;
};

export type AdStatus = 'live' | 'scheduled' | 'paused' | 'ended';

/** Where an ad shows: the Home card carousel, the feed, or both. */
export type AdPlacement = 'home' | 'feed';
export const PLACEMENT_LABEL: Record<AdPlacement, string> = { home: 'Home card', feed: 'Feed' };

export type AdminAd = AdSlide & {
  name: string;
  status: AdStatus;
  active: boolean;
  placements: AdPlacement[];
  institution_id: number | null;
  university: string | null;
  starts_at: string;
  ends_at: string | null;
  priority: number;
  created_by: string | null;
  updated_at: string;
  viewers: number;
  views: number;
  taps: number;
  by_placement: Partial<Record<AdPlacement, { viewers: number; taps: number }>>;
};

export type AdminAds = {
  national: boolean;
  universities: { id: number; name: string; short_name: string | null }[];
  ads: AdminAd[];
};

export type AdDraft = {
  name: string;
  sponsor: string;
  headline: string;
  body: string;
  cta_label: string;
  link_url: string;
  media_kind: 'image' | 'video';
  media_path: string;
  poster_path: string | null;
  institution_id: number | null;
  starts_at: string;
  ends_at: string | null;
  priority: number;
  active: boolean;
  placements: AdPlacement[];
};

/** Ads are 1.91:1 (1200 × 628), the usual landscape size for Google and Facebook ads, so ready-made
 * ads fit as they are. On a phone that is about 185 points tall. */
export const AD_RATIO = 1200 / 628;

export const AD_STATUS: Record<AdStatus, string> = { live: 'Live', scheduled: 'Scheduled', paused: 'Paused', ended: 'Ended' };

type Result<T> = { data: T; error: null } | { data: null; error: string };

async function result<T>(call: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Result<T>> {
  const { data, error } = await call;
  if (error) return { data: null, error: error.message };
  return { data: data as T, error: null };
}

// ---------------------------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------------------------

const CACHE = 'home:ads';

/** The slides as they were last time, to show at once. */
export const cachedAds = () => readCache<AdSlide[]>(CACHE) ?? [];

export async function loadHomeAds() {
  const { data } = await supabase.rpc('home_ads');
  const list = Array.isArray(data) ? (data as AdSlide[]) : null;
  if (list) writeCache(CACHE, list);
  return list;
}

const seen = new Set<string>();

/** Counts an ad as seen (once per app session and placement; the server counts once a day). */
export function adSeen(id: string, placement: AdPlacement = 'home') {
  if (seen.has(`${placement}:${id}`)) return;
  seen.add(`${placement}:${id}`);
  supabase.rpc('ad_event', { p_ad_id: id, p_placement: placement }).then(() => {});
}

/** Opens the ad's link (https only) and counts the tap. */
export async function openAd(ad: AdSlide, placement: AdPlacement = 'home') {
  supabase.rpc('ad_event', { p_ad_id: ad.id, p_tap: true, p_placement: placement }).then(() => {});
  if (ad.link_url && /^https:\/\//.test(ad.link_url)) await Linking.openURL(ad.link_url).catch(() => {});
}

/** The media's address: a file on the phone before upload, otherwise the public bucket. */
export const adMedia = (path: string | null | undefined) =>
  path && /^(file|content|ph|blob):/.test(path) ? path : mediaUrl(path);

/** Videos play by themselves on Wi-Fi only, so students on mobile data are not charged for them. */
export async function onWifi() {
  if (!hasNative('ExpoNetwork')) return false;
  const Network = require('expo-network') as typeof NetworkModule;
  const state = await Network.getNetworkStateAsync().catch(() => null);
  return state?.type === Network.NetworkStateType.WIFI;
}

// ---------------------------------------------------------------------------------------------
// Admins
// ---------------------------------------------------------------------------------------------

export const loadAdminAds = () => result<AdminAds>(supabase.rpc('admin_ads'));
export const saveAd = (id: string | null, draft: AdDraft) =>
  result<AdSlide & { status: AdStatus }>(supabase.rpc('save_ad', { p_ad: draft, ...(id ? { p_ad_id: id } : {}) }));
export const setAdActive = (id: string, active: boolean) =>
  result<null>(supabase.rpc('set_ad_active', { p_ad_id: id, p_active: active }));
export const deleteAd = (id: string) => result<null>(supabase.rpc('delete_ad', { p_ad_id: id }));

export type PickedMedia = { uri: string; mime: string; kind: 'image' | 'video'; width: number; height: number };

const VIDEO_MAX = 25_000_000;
const IMAGE_MAX = 5_000_000;

/** Chooses the ad's photo, GIF or video (kind 'media'), or a video's cover photo ('poster'). Photos are
 * re-encoded as JPEG up to 1800 px wide (drops EXIF location); GIFs and videos upload as they are. */
export async function pickAdMedia(kind: 'media' | 'poster'): Promise<PickedMedia | { error: string } | null> {
  if (!hasNative('ExponentFileSystem')) return { error: UPDATE_APP };
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: kind === 'media' ? ['images', 'videos'] : ['images'],
    quality: 1,
    videoMaxDuration: 60,
  });
  if (picked.canceled || !picked.assets[0]) return null;
  const asset = picked.assets[0];
  if (asset.type === 'video') {
    const mime = asset.mimeType === 'video/quicktime' || /\.mov$/i.test(asset.uri) ? 'video/quicktime' : 'video/mp4';
    const size = asset.fileSize ?? (await fileSize(asset.uri));
    if (size > VIDEO_MAX) return { error: 'That video is over 25 MB. Use a shorter one (under 30 seconds works best).' };
    return { uri: asset.uri, mime, kind: 'video', width: asset.width, height: asset.height };
  }
  if (asset.mimeType === 'image/gif' || /\.gif$/i.test(asset.fileName ?? asset.uri)) {
    if (kind === 'poster') return { error: 'Use a photo (not a GIF) for the cover.' };
    const size = asset.fileSize ?? (await fileSize(asset.uri));
    if (size > IMAGE_MAX) return { error: 'That GIF is over 5 MB.' };
    return { uri: asset.uri, mime: 'image/gif', kind: 'image', width: asset.width, height: asset.height };
  }
  const context = ImageManipulator.manipulate(asset.uri);
  if (asset.width > 1800) context.resize({ width: 1800 });
  const image = await (await context.renderAsync()).saveAsync({ compress: 0.88, format: SaveFormat.JPEG });
  return { uri: image.uri, mime: 'image/jpeg', kind: 'image', width: image.width, height: image.height };
}

async function functionError(error: unknown, fallback: string) {
  const response = (error as { context?: Response }).context;
  const body = response && typeof response.json === 'function' ? await response.json().catch(() => null) : null;
  return (body?.error as string | undefined) ?? fallback;
}

/** Uploads one ad file to the public bucket and has it checked. Resolves with its path. */
export async function uploadAdFile(
  kind: 'media' | 'poster',
  file: { uri: string; mime: string },
  onProgress: (share: number) => void = () => {},
): Promise<{ path: string } | { error: string }> {
  const size = await fileSize(file.uri);
  if (size <= 0) return { error: 'Could not read that file. Try another one.' };
  for (let round = 0; round < 2; round++) {
    const { data, error } = await supabase.functions.invoke('media', {
      body: { action: 'ad_sign', kind, mime: file.mime, size },
      timeout: 20_000,
    });
    if (error) return { error: await functionError(error, 'The upload could not start. Check your connection.') };
    const signed = data as { url: string; path: string; headers: Record<string, string> };
    const status = await putFile(signed.url, signed.headers, file.uri, onProgress);
    if (status >= 200 && status < 300) {
      const check = await supabase.functions.invoke('media', {
        body: { action: 'ad_commit', path: signed.path },
        timeout: 30_000,
      });
      if (check.error) return { error: await functionError(check.error, 'The file could not be checked. Try again.') };
      return { path: signed.path };
    }
    if (status !== 403) break;
  }
  return { error: 'The upload did not finish. Check your connection and try again.' };
}
