import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useSyncExternalStore } from 'react';

import type { AdSlide } from '@/lib/ads';
import { dayMonth } from '@/lib/dates';
import { fileSize, putFile } from '@/lib/chat/transfer';
import type { Kuppi } from '@/lib/kuppi';
import { mediaUrl } from '@/lib/media';
import { hasNative, UPDATE_APP } from '@/lib/native';
import type { SharedFile } from '@/lib/shared';
import type { ListingCard } from '@/lib/shop';
import { onSignOut } from '@/lib/resets';
import { supabase } from '@/lib/supabase';

// The home feed (see the home feed migration). Built to cost little: a refresh is one call (the
// ranked ids, the first page and the extra cards), each further page one call that also carries the
// posts seen since; likes wait 400 ms so quick taps send one call. Posts live in one store, so the
// feed and the post screen show the same likes and counts without fetching again.

export type PostTag = 'question' | 'lost_found' | 'notice' | 'bodim' | 'job';
export const TAG_LABEL: Record<PostTag, string> = {
  question: 'Question',
  lost_found: 'Lost & found',
  notice: 'Notice',
  bodim: 'Bodim',
  job: 'Part-time job',
};

export type LostFoundDetails = { kind: 'lost' | 'found'; where?: string };
export type BodimGender = 'girls' | 'boys' | 'anyone';
export type BodimRoom = 'single' | 'shared' | 'annex' | 'house';
export type BodimDetails = {
  rent: number;
  gender: BodimGender;
  room: BodimRoom;
  area: string;
  /** Minutes' walk to campus. */
  walk?: number;
  facilities?: Facility[];
  phone?: string;
  /** "2026-11-01" */
  available_from?: string;
};

export const GENDER_LABEL: Record<BodimGender, string> = { girls: 'For girls', boys: 'For boys', anyone: 'For anyone' };
/** A part-time job. Pay is optional ("to discuss"); remote work needs no area. */
export type JobPer = 'hour' | 'day' | 'week' | 'month' | 'task';
export type JobDetails = {
  role: string;
  pay?: number;
  per?: JobPer;
  remote?: boolean;
  area?: string;
  /** "Weekends, 4 hours" */
  hours?: string;
  phone?: string;
  /** "2026-11-30" */
  closes_on?: string;
};
export const PER_LABEL: Record<JobPer, string> = {
  hour: 'an hour',
  day: 'a day',
  week: 'a week',
  month: 'a month',
  task: 'for the task',
};

/** True when a job's closing day has passed (Sri Lanka time). */
export function jobClosed(details: JobDetails | null | undefined, now = Date.now()) {
  if (!details?.closes_on) return false;
  const today = new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  return details.closes_on < today;
}

export const ROOM_LABEL: Record<BodimRoom, string> = {
  single: 'Single room',
  shared: 'Shared room',
  annex: 'Annex',
  house: 'Whole house',
};
export const FACILITIES = [
  ['wifi', 'Wi-Fi'],
  ['meals', 'Meals'],
  ['attached_bath', 'Attached bathroom'],
  ['kitchen', 'Kitchen'],
  ['ac', 'A/C'],
  ['furnished', 'Furnished'],
  ['bills_included', 'Bills included'],
  ['laundry', 'Laundry'],
  ['study_area', 'Study table'],
  ['parking', 'Parking'],
] as const;
export type Facility = (typeof FACILITIES)[number][0];
export const FACILITY_LABEL = Object.fromEntries(FACILITIES) as Record<Facility, string>;

/** "Rs 15,000" */
export const rupees = (n: number) => `Rs ${n.toLocaleString('en-US')}`;

/** What "done" means for a post: Answered, Returned, Found, Taken (null: it cannot be done). */
export function doneLabel(post: Pick<Post, 'tag' | 'details'>) {
  if (post.tag === 'question') return { done: 'Answered', mark: 'Mark as answered' };
  if (post.tag === 'bodim') return { done: 'Taken', mark: 'Mark as taken' };
  if (post.tag === 'job') return { done: 'Filled', mark: 'Mark as filled' };
  if (post.tag === 'lost_found') {
    return (post.details as LostFoundDetails | null)?.kind === 'found'
      ? { done: 'Back with its owner', mark: 'Mark as returned' }
      : { done: 'Found it', mark: 'Mark as found' };
  }
  return null;
}

export type FeedPhoto = { id: string; w: number; h: number };

export type Post = {
  id: number;
  body: string;
  tag: PostTag | null;
  notice_from: string | null;
  details: LostFoundDetails | BodimDetails | JobDetails | null;
  /** Answered, returned or taken. */
  resolved: boolean;
  edited: boolean;
  audience: 'university' | 'everyone';
  photos: FeedPhoto[];
  like_count: number;
  comment_count: number;
  liked: boolean;
  created_at: string;
  mine: boolean;
  status: 'live' | 'hidden' | 'removed';
  /** From another university. */
  other: boolean;
  author: { id: string; name: string; avatar_path: string | null; line: string | null };
  /** The post screen: the caller moderates this university. */
  can_moderate?: boolean;
};

export type FeedComment = {
  id: number;
  parent_id: number | null;
  body: string;
  created_at: string;
  mine: boolean;
  can_delete: boolean;
  author: { id: string; name: string; avatar_path: string | null };
};

export type FeedStart = {
  ids: number[];
  posts: Post[];
  /** Who the student may post notices as ("Batch rep", a club, "Uni Era team"), or null. */
  notice_as: string | null;
  ads: AdSlide[];
  shop: ListingCard[];
  kuppi: Kuppi[];
  files: SharedFile[];
};

export const PAGE = 15;

/** The feed copy (1080 px wide) or the full copy of a photo. */
export const photoUrl = (id: string, full = false) => mediaUrl(`posts/${id}${full ? '.full' : ''}.jpg`);

/** "now", "5m", "3h", "2d", then the date. */
export function ago(at: string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - new Date(at).getTime()) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / (24 * 60))}d`;
  return dayMonth(at);
}

type Result<T> = { data: T; error: null } | { data: null; error: string };

async function result<T>(call: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Result<T>> {
  const { data, error } = await call;
  if (error) return { data: null, error: error.message };
  return { data: data as T, error: null };
}

// ---------------------------------------------------------------------------------------------
// The post store
// ---------------------------------------------------------------------------------------------

type Local = { hidden?: boolean; deleted?: boolean };
const posts = new Map<number, Post & Local>();
const listeners = new Map<number, Set<() => void>>();

function emit(id: number) {
  listeners.get(id)?.forEach((l) => l());
}

/** Puts posts from the server in the store. A like still waiting to be sent keeps its local state. */
export function putPosts(list: Post[]) {
  for (const p of list) {
    const old = posts.get(p.id);
    const waiting = pendingLikes.get(p.id);
    posts.set(p.id, {
      ...p,
      ...(waiting && old ? { liked: old.liked, like_count: old.like_count } : null),
      hidden: old?.hidden,
      deleted: old?.deleted,
    });
    emit(p.id);
  }
}

export function patchPost(id: number, patch: Partial<Post & Local>) {
  const old = posts.get(id);
  if (!old) return;
  posts.set(id, { ...old, ...patch });
  emit(id);
}

export const peekPost = (id: number) => posts.get(id);

export function usePost(id: number) {
  return useSyncExternalStore(
    (listener) => {
      let set = listeners.get(id);
      if (!set) listeners.set(id, (set = new Set()));
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(id);
      };
    },
    () => posts.get(id),
  );
}

// ---------------------------------------------------------------------------------------------
// Likes: shown at once, sent once the taps settle
// ---------------------------------------------------------------------------------------------

const pendingLikes = new Map<number, { timer: ReturnType<typeof setTimeout>; server: boolean; serverCount: number }>();

export function toggleLike(id: number) {
  const p = posts.get(id);
  if (!p || p.status !== 'live') return;
  const next = !p.liked;
  const entry = pendingLikes.get(id) ?? {
    timer: 0 as unknown as ReturnType<typeof setTimeout>,
    server: p.liked,
    serverCount: p.like_count,
  };
  clearTimeout(entry.timer);
  patchPost(id, { liked: next, like_count: Math.max(0, p.like_count + (next ? 1 : -1)) });
  entry.timer = setTimeout(async () => {
    pendingLikes.delete(id);
    if (next === entry.server) return;
    const { data, error } = await supabase.rpc('like_post', { p_post_id: id, p_on: next });
    if (pendingLikes.has(id)) return; // tapped again meanwhile: that call settles it
    if (error) patchPost(id, { liked: entry.server, like_count: entry.serverCount });
    else patchPost(id, { liked: next, like_count: (data as { like_count: number }).like_count });
  }, 400);
  pendingLikes.set(id, entry);
}

// ---------------------------------------------------------------------------------------------
// Seen posts: sent with the next page or refresh, or when the app goes to the background
// ---------------------------------------------------------------------------------------------

const seenWaiting = new Set<number>();
const seenSent = new Set<number>();

// The next account starts with no posts, likes or seen marks from this one.
onSignOut(() => {
  for (const p of pendingLikes.values()) clearTimeout(p.timer);
  pendingLikes.clear();
  posts.clear();
  seenWaiting.clear();
  seenSent.clear();
});

export function markSeen(id: number) {
  if (!seenSent.has(id)) seenWaiting.add(id);
}

function takeSeen() {
  const ids = [...seenWaiting].slice(0, 100);
  ids.forEach((id) => {
    seenWaiting.delete(id);
    seenSent.add(id);
  });
  return ids;
}

function giveBackSeen(ids: number[]) {
  ids.forEach((id) => {
    seenSent.delete(id);
    seenWaiting.add(id);
  });
}

export function flushSeen() {
  const ids = takeSeen();
  if (ids.length > 0) supabase.rpc('feed_seen', { p_ids: ids }).then(({ error }) => error && giveBackSeen(ids));
}

// ---------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------

export async function loadFeed(tag: PostTag | null = null) {
  const seen = takeSeen();
  const r = await result<FeedStart>(
    supabase.rpc('feed', { ...(seen.length ? { p_seen: seen } : {}), ...(tag ? { p_tag: tag } : {}) }),
  );
  if (r.error !== null) giveBackSeen(seen);
  else putPosts(r.data.posts);
  return r;
}

export async function loadPosts(ids: number[]) {
  const seen = takeSeen();
  const r = await result<Post[]>(supabase.rpc('feed_posts', { p_ids: ids, ...(seen.length ? { p_seen: seen } : {}) }));
  if (r.error !== null) giveBackSeen(seen);
  else putPosts(r.data);
  return r;
}

export async function loadPost(id: number, after?: number) {
  const r = await result<{ post: Post | null; comments: FeedComment[]; more: boolean }>(
    supabase.rpc('post_comments', { p_post_id: id, ...(after ? { p_after: after } : {}) }),
  );
  if (r.data?.post) putPosts([r.data.post]);
  return r;
}

// ---------------------------------------------------------------------------------------------
// Comments, hiding, muting, deleting
// ---------------------------------------------------------------------------------------------

export async function addComment(postId: number, body: string, parentId?: number | null) {
  const r = await result<FeedComment>(
    supabase.rpc('add_comment', { p_post_id: postId, p_body: body, ...(parentId ? { p_parent_id: parentId } : {}) }),
  );
  const p = posts.get(postId);
  if (r.data && p) patchPost(postId, { comment_count: p.comment_count + 1 });
  return r;
}

/** Deletes a comment; `removed` is how many went (the comment and its replies). */
export async function deleteComment(postId: number, commentId: number, removed: number) {
  const r = await result<null>(supabase.rpc('delete_comment', { p_comment_id: commentId }));
  const p = posts.get(postId);
  if (!r.error && p) patchPost(postId, { comment_count: Math.max(0, p.comment_count - removed) });
  return r;
}

export async function hidePost(id: number) {
  patchPost(id, { hidden: true });
  const r = await result<{ author_hidden: number }>(supabase.rpc('hide_post', { p_post_id: id }));
  if (r.error) patchPost(id, { hidden: false });
  return r;
}

export async function undoHide(id: number) {
  patchPost(id, { hidden: false });
  await supabase.rpc('undo_hide_post', { p_post_id: id });
}

/** The author marks the post answered, returned or taken (or undoes it). */
export async function setResolved(id: number, resolved: boolean) {
  const old = posts.get(id);
  patchPost(id, { resolved });
  const r = await result<Post>(supabase.rpc('set_post_resolved', { p_post_id: id, p_resolved: resolved }));
  if (r.data) putPosts([r.data]);
  else if (old) patchPost(id, { resolved: old.resolved });
  return r;
}

export type PostInput = {
  body: string;
  tag: PostTag | null;
  details: LostFoundDetails | BodimDetails | JobDetails | null;
  audience: 'university' | 'everyone';
};

/** The author changes the text, details and who sees it. */
export async function editPost(id: number, input: Omit<PostInput, 'tag'>) {
  const r = await result<Post>(supabase.rpc('edit_post', { p_post_id: id, p_post: input }));
  if (r.data) putPosts([r.data]);
  return r;
}

export const muteAuthor = (userId: string, on: boolean) =>
  result<null>(supabase.rpc('mute_author', { p_user_id: userId, p_on: on }));

async function functionError(error: unknown, fallback: string) {
  const response = (error as { context?: Response }).context;
  const body = response && typeof response.json === 'function' ? await response.json().catch(() => null) : null;
  return (body?.error as string | undefined) ?? fallback;
}

/** Deletes the student's own post (and its photos), or removes one as a moderator. */
export async function deletePost(id: number): Promise<{ error: string | null }> {
  const { error } = await supabase.functions.invoke('media', { body: { action: 'post_delete', post_id: id }, timeout: 20_000 });
  if (error) return { error: await functionError(error, 'Could not delete it. Check your connection.') };
  patchPost(id, { deleted: true });
  return { error: null };
}

export type ReviewPost = Post & { university: string; reports: { category: string; details: string | null }[] | null };
export const loadReview = () => result<ReviewPost[]>(supabase.rpc('feed_review'));
export const reviewPost = (id: number, action: 'restore' | 'remove') =>
  result<null>(supabase.rpc('review_post', { p_post_id: id, p_action: action }));

// ---------------------------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------------------------

export type PickedPhoto = { uri: string; fullUri: string; width: number; height: number; size: number; fullSize: number };

const FEED_MAX = 1_500_000;
const FULL_MAX = 4_000_000;

async function encode(uri: string, width: number, height: number, maxWidth: number, maxHeight: number, quality: number) {
  const context = ImageManipulator.manipulate(uri);
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  if (scale < 1) context.resize({ width: Math.round(width * scale) });
  const image = await (await context.renderAsync()).saveAsync({ compress: quality, format: SaveFormat.JPEG });
  return { uri: image.uri, width: image.width, height: image.height, size: await fileSize(image.uri) };
}

/** Chooses up to `limit` photos. Each becomes two JPEGs (no EXIF, so no location): the feed copy,
 * 1080 px wide (about 150 KB, light on mobile data), and the full copy, up to 2048 px, opened on tap. */
export async function pickPostPhotos(limit: number): Promise<PickedPhoto[] | { error: string } | null> {
  if (!hasNative('ExponentFileSystem')) return { error: UPDATE_APP };
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    quality: 1,
  });
  if (picked.canceled) return null;
  const out: PickedPhoto[] = [];
  for (const asset of picked.assets.slice(0, limit)) {
    let feed = await encode(asset.uri, asset.width, asset.height, 1080, 2160, 0.72);
    if (feed.size > FEED_MAX) feed = await encode(asset.uri, asset.width, asset.height, 1080, 1350, 0.55);
    let full = await encode(asset.uri, asset.width, asset.height, 2048, 2048, 0.82);
    if (full.size > FULL_MAX) full = await encode(asset.uri, asset.width, asset.height, 1600, 1600, 0.7);
    if (feed.size > FEED_MAX || full.size > FULL_MAX || feed.size <= 0 || full.size <= 0) {
      return { error: 'One of the photos could not be prepared. Try another one.' };
    }
    out.push({ uri: feed.uri, fullUri: full.uri, width: feed.width, height: feed.height, size: feed.size, fullSize: full.size });
  }
  return out;
}

/** Uploads the photos (two calls to the media function for all of them) and creates the post. */
export async function createPost(
  input: PostInput & { photos: PickedPhoto[] },
  onProgress: (share: number) => void = () => {},
): Promise<Result<Post>> {
  let ids: string[] = [];
  if (input.photos.length > 0) {
    const { data, error } = await supabase.functions.invoke('media', {
      body: {
        action: 'post_sign',
        photos: input.photos.map((p) => ({ size: p.size, full_size: p.fullSize, width: p.width, height: p.height })),
      },
      timeout: 20_000,
    });
    if (error) return { data: null, error: await functionError(error, 'The upload could not start. Check your connection.') };
    const signed = data as { photos: { id: string; url: string; full_url: string }[]; headers: Record<string, string> };
    const total = input.photos.reduce((n, p) => n + p.size + p.fullSize, 0);
    const done = new Map<string, number>();
    const report = (key: string, bytes: number) => {
      done.set(key, bytes);
      onProgress([...done.values()].reduce((a, b) => a + b, 0) / total);
    };
    const statuses = await Promise.all(
      signed.photos.flatMap((s, i) => [
        putFile(s.url, signed.headers, input.photos[i].uri, (share) => report(`${i}`, share * input.photos[i].size)),
        putFile(s.full_url, signed.headers, input.photos[i].fullUri, (share) =>
          report(`${i}f`, share * input.photos[i].fullSize),
        ),
      ]),
    );
    if (statuses.some((s) => s < 200 || s >= 300)) {
      return { data: null, error: 'The photos did not finish uploading. Check your connection and try again.' };
    }
    ids = signed.photos.map((s) => s.id);
    const check = await supabase.functions.invoke('media', { body: { action: 'post_commit', ids }, timeout: 30_000 });
    if (check.error)
      return { data: null, error: await functionError(check.error, 'The photos could not be checked. Try again.') };
  }
  const r = await result<Post>(
    supabase.rpc('create_post', {
      p_post: { body: input.body, tag: input.tag, details: input.details, audience: input.audience, photos: ids },
    }),
  );
  if (r.data) {
    putPosts([r.data]);
    const id = r.data.id;
    posted.forEach((l) => l(id));
  }
  return r;
}

const posted = new Set<(id: number) => void>();

/** Calls back with each new post the student makes (the feed puts it on top at once). */
export function onPosted(listener: (id: number) => void) {
  posted.add(listener);
  return () => {
    posted.delete(listener);
  };
}
