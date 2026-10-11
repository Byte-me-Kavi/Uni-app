import { useEffect, useState } from 'react';

import { readCache, writeCache } from '@/lib/cache';
import type { LinkPreview } from '@/lib/chat/types';
import { supabase } from '@/lib/supabase';

// Previews for links in messages that arrived without one (sent before the sender's preview was
// ready, or from an older app). Made by our link-preview function, so the website never sees the
// reader's phone; kept in memory and on the phone for a day, "no preview" included, so each link
// is asked for once.

type Entry = { preview: LinkPreview | null; until: number };
const DAY_MS = 24 * 60 * 60 * 1000;
const memory = new Map<string, Entry>();
const pending = new Map<string, Promise<LinkPreview | null>>();
const key = (url: string) => `link:${url}`;

const URL_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+\.[a-z]{2,}[^\s]*)/i;

/** The first link in a text, as a full https address. */
export function firstLink(text: string | null | undefined) {
  const found = text ? URL_PATTERN.exec(text)?.[0] : null;
  if (!found) return null;
  const clean = found.replace(/[).,!?'"]+$/, '');
  return /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
}

function known(url: string) {
  const hit = memory.get(url) ?? readCache<Entry>(key(url));
  if (hit && hit.until > Date.now()) {
    memory.set(url, hit);
    return hit;
  }
  return null;
}

async function fetchPreview(url: string) {
  const { data } = await supabase.functions
    .invoke('link-preview', { body: { url }, timeout: 8000 })
    .catch(() => ({ data: null }));
  const preview = (data as { preview: LinkPreview | null } | null)?.preview ?? null;
  const entry = { preview, until: Date.now() + DAY_MS };
  memory.set(url, entry);
  writeCache(key(url), entry);
  return preview;
}

/** The preview for a link (null while loading, or when the page has none). */
export function useLinkPreview(url: string | null) {
  const [preview, setPreview] = useState<LinkPreview | null>(() => (url ? (known(url)?.preview ?? null) : null));
  useEffect(() => {
    if (!url) {
      setPreview(null);
      return;
    }
    const hit = known(url);
    if (hit) {
      setPreview(hit.preview);
      return;
    }
    let live = true;
    let request = pending.get(url);
    if (!request) {
      request = fetchPreview(url).finally(() => pending.delete(url));
      pending.set(url, request);
    }
    request.then((p) => live && setPreview(p));
    return () => {
      live = false;
    };
  }, [url]);
  return preview;
}
