import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { AdSlide } from '@/lib/ads';
import { readCache, writeCache } from '@/lib/cache';
import { flushSeen, loadFeed, loadPosts, onPosted, PAGE, putPosts, type FeedStart, type PostTag } from '@/lib/feed';
import type { Kuppi } from '@/lib/kuppi';
import type { SharedFile } from '@/lib/shared';
import type { ListingCard } from '@/lib/shop';
import { useSession } from '@/providers/session-provider';

export type FeedItem =
  | { type: 'post'; key: string; id: number }
  | { type: 'ad'; key: string; ad: AdSlide }
  | { type: 'shop'; key: string; listings: ListingCard[] }
  | { type: 'kuppi'; key: string; kuppi: Kuppi[] }
  | { type: 'files'; key: string; files: SharedFile[] };

// Where the extra cards go, counted in posts above them. Ads never come first, and at most one in
// every 12 posts. The shop shows twice (the newest five, then the next five).
const KUPPI_AFTER = 2;
const AD_AFTER = [4, 16, 28];
const SHOP_AFTER = [7, 22];
const SHOP_ROW = 5;
const FILES_AFTER = 11;
// Coming back to the app after this long refreshes the feed by itself.
const STALE_MS = 15 * 60 * 1000;

type Loaded = { start: FeedStart; tag: PostTag | null };

// The feed's state: the last copy on the phone shows at once, then one call refreshes it; more
// posts load 15 at a time as the student nears the end. Seen posts go to the server with those
// calls (or when the app goes to the background). A refresh the student did not ask for, while they
// are reading further down, waits behind a "New posts" button instead of moving the list under
// their finger. A filter (Questions, Lost & found, Bodim, Notices) shows only that kind.
export function useFeed(enabled: boolean) {
  const session = useSession();
  const cacheKey = session.status === 'signed_in' ? `${session.session.user.id}:feed` : null;
  const [start, setStart] = useState<FeedStart | null>(() => {
    const cached = cacheKey ? readCache<FeedStart>(cacheKey) : null;
    if (cached) putPosts(cached.posts);
    return cached;
  });
  const [tag, setTag] = useState<PostTag | null>(null);
  const [shown, setShown] = useState<number[]>(() => start?.posts.map((p) => p.id) ?? []);
  const [mine, setMine] = useState<number[]>([]);
  const [status, setStatus] = useState<'idle' | 'refreshing' | 'switching' | 'more' | 'error'>('idle');
  const [cursor, setCursor] = useState(() => (start?.posts.length ? PAGE : 0));
  const [waiting, setWaiting] = useState<Loaded | null>(null);
  const busy = useRef(false);
  const loadedAt = useRef(0);
  const tagNow = useRef<PostTag | null>(null);
  const reading = useRef(false);

  const apply = useCallback(
    ({ start: next, tag: nextTag }: Loaded) => {
      loadedAt.current = Date.now();
      setCursor(PAGE);
      setStart(next);
      setShown(next.posts.map((p) => p.id));
      setMine([]);
      setWaiting(null);
      setStatus('idle');
      if (cacheKey && nextTag === null) writeCache(cacheKey, next);
    },
    [cacheKey],
  );

  // Loads a fresh feed for a filter. Quiet: the student did not ask (opening Home, coming back to
  // the app), so no spinner, and if they are reading further down it waits behind "New posts".
  const reload = useCallback(
    async (forTag: PostTag | null, quiet: boolean) => {
      if (!enabled || busy.current) return;
      busy.current = true;
      const r = await loadFeed(forTag);
      busy.current = false;
      if (forTag !== tagNow.current) return; // the student picked another filter meanwhile
      if (r.error !== null) return setStatus('error');
      if (quiet && reading.current) {
        setWaiting({ start: r.data, tag: forTag });
        loadedAt.current = Date.now();
        return;
      }
      apply({ start: r.data, tag: forTag });
    },
    [enabled, apply],
  );

  /** Pull to refresh: with the spinner, always applied. */
  const refresh = useCallback(async () => {
    if (!enabled || busy.current) return;
    setStatus('refreshing');
    await reload(tagNow.current, false);
  }, [enabled, reload]);

  /** Shows only one kind of post (null: everything). */
  const filter = useCallback(
    (next: PostTag | null) => {
      if (next === tagNow.current) return;
      tagNow.current = next;
      setTag(next);
      setWaiting(null);
      setShown([]);
      setStart(null);
      setStatus('switching');
      busy.current = false;
      reload(next, false);
    },
    [reload],
  );

  /** Shows the refresh that waited behind "New posts". */
  const showWaiting = useCallback(() => {
    if (waiting) apply(waiting);
  }, [waiting, apply]);

  /** Home tells the feed how far down the student is reading. */
  const onScrollY = useCallback((y: number) => {
    reading.current = y > 600;
  }, []);

  const more = useCallback(async () => {
    if (!start || busy.current || cursor >= start.ids.length) return;
    busy.current = true;
    setStatus('more');
    const next = start.ids.slice(cursor, cursor + PAGE);
    const r = await loadPosts(next);
    busy.current = false;
    if (r.error !== null) return setStatus('error');
    setCursor((c) => c + PAGE);
    const ids = r.data.map((p) => p.id);
    setShown((s) => [...s, ...ids.filter((id) => !s.includes(id))]);
    setStatus('idle');
  }, [start, cursor]);

  useEffect(() => {
    reload(null, true);
  }, [reload]);

  useEffect(() => {
    const off = onPosted((id) => setMine((m) => [id, ...m]));
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'background') flushSeen();
      if (state === 'active' && Date.now() - loadedAt.current > STALE_MS) reload(tagNow.current, true);
    });
    return () => {
      off();
      app.remove();
    };
  }, [reload]);

  const items = useMemo<FeedItem[]>(() => {
    const ids = [...mine, ...shown.filter((id) => !mine.includes(id))];
    const out: FeedItem[] = [];
    const ads = start?.ads ?? [];
    const shop = start?.shop ?? [];
    let posts = 0;
    const shopRow = (n: number) => {
      const listings = shop.slice(n * SHOP_ROW, (n + 1) * SHOP_ROW);
      if (listings.length) out.push({ type: 'shop', key: `shop:${n}`, listings });
    };
    const extras = () => {
      if (posts === KUPPI_AFTER && start?.kuppi.length) out.push({ type: 'kuppi', key: 'kuppi', kuppi: start.kuppi });
      const ad = AD_AFTER.indexOf(posts);
      if (ad >= 0 && ads[ad]) out.push({ type: 'ad', key: `ad:${ads[ad].id}`, ad: ads[ad] });
      const row = SHOP_AFTER.indexOf(posts);
      if (row >= 0) shopRow(row);
      if (posts === FILES_AFTER && start?.files.length) out.push({ type: 'files', key: 'files', files: start.files });
    };
    for (const id of ids) {
      out.push({ type: 'post', key: `post:${id}`, id });
      posts += 1;
      extras();
    }
    // A quiet feed still shows what is coming up in the student's modules and the shop.
    const done = cursor >= (start?.ids.length ?? 0);
    if (done) {
      if (posts < KUPPI_AFTER && start?.kuppi.length) out.push({ type: 'kuppi', key: 'kuppi', kuppi: start.kuppi });
      if (posts < SHOP_AFTER[0]) shopRow(0);
      if (posts < SHOP_AFTER[1]) shopRow(1);
      if (posts < FILES_AFTER && start?.files.length) out.push({ type: 'files', key: 'files', files: start.files });
    }
    return out;
  }, [start, shown, mine, cursor]);

  return {
    items,
    tag,
    filter,
    noticeAs: start?.notice_as ?? null,
    loaded: !!start,
    end: !!start && cursor >= start.ids.length,
    status,
    refresh,
    more,
    hasNew: !!waiting,
    showWaiting,
    onScrollY,
  };
}
