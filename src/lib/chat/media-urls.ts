import { useEffect, useState } from 'react';

import { forgetCache, readCache, readCacheByPrefix, writeCache } from '@/lib/cache';
import { supabase } from '@/lib/supabase';

// Photos, documents and voice notes sent in chats live in a private bucket. Each is read through
// a signed link that lasts 6 hours, given by the media function only to students in a chat that
// has the file. Links are asked for in batches (everything a chat screen needs, in one request),
// kept in memory and on the phone, and renewed 30 minutes before they expire. Images use the path
// as their cache key, so a renewed link never downloads a photo again.

type Entry = { url: string; until: number };

const MARGIN_MS = 30 * 60 * 1000;
const memory = new Map<string, Entry>();
const waiting = new Map<string, ((url: string | null) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

const key = (path: string) => `media:${path}`;
let warmed = false; // once true, memory holds everything saved and storage is not read per photo
let warming = false;

/** At startup: every saved link goes into memory in one background pass, so photos in a chat
 * find their link without reading the phone's storage while the chat draws. Expired ones go. */
export async function warmSignedUrls() {
  if (warmed || warming) return;
  warming = true;
  const entries = await readCacheByPrefix<Entry>('media:').catch(() => []);
  const now = Date.now();
  for (const [k, entry] of entries) {
    const path = k.slice('media:'.length);
    if (entry.until - MARGIN_MS > now) {
      if (!memory.has(path)) memory.set(path, entry);
    } else forgetCache(k);
  }
  warmed = true;
}

function fresh(path: string) {
  const hit = memory.get(path) ?? (warmed ? null : readCache<Entry>(key(path)));
  if (hit && hit.until - MARGIN_MS > Date.now()) {
    memory.set(path, hit);
    return hit.url;
  }
  return null;
}

async function flush() {
  timer = null;
  const batch = [...waiting.entries()].slice(0, 100);
  for (const [path] of batch) waiting.delete(path);
  if (waiting.size > 0) timer = setTimeout(flush, 0);

  let urls: Record<string, string> = {};
  let seconds = 0;
  try {
    const { data } = await supabase.functions.invoke('media', {
      body: { action: 'read', paths: batch.map(([path]) => path) },
      timeout: 15_000,
    });
    urls = (data as { urls?: Record<string, string> } | null)?.urls ?? {};
    seconds = (data as { expires_in?: number } | null)?.expires_in ?? 0;
  } catch {
    // Offline: the callers try again when they next render.
  }
  for (const [path, callbacks] of batch) {
    const url = urls[path] ?? null;
    if (url) {
      const entry = { url, until: Date.now() + seconds * 1000 };
      memory.set(path, entry);
      writeCache(key(path), entry);
    }
    callbacks.forEach((callback) => callback(url));
  }
}

/** A signed link for a private chat file, or null if it cannot be read (yet). */
export function signedUrl(path: string): Promise<string | null> {
  const known = fresh(path);
  if (known) return Promise.resolve(known);
  return new Promise((resolve) => {
    waiting.set(path, [...(waiting.get(path) ?? []), resolve]);
    if (!timer) timer = setTimeout(flush, 25); // gather everything asked for in this render
  });
}

/** The signed link for a path, once known. Null while it loads, or for no path. */
export function useSignedUrl(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(() => (path ? fresh(path) : null));
  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    let live = true;
    signedUrl(path).then((next) => live && setUrl(next));
    return () => {
      live = false;
    };
  }, [path]);
  return url;
}
