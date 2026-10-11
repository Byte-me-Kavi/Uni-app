// The web app keeps the same small cache in localStorage (see cache.ts). It can be unavailable
// (private windows, blocked site data), so every access is guarded and the app works without it.

export function readCache<T>(key: string): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(`uniera:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeCache(key: string, value: unknown) {
  try {
    globalThis.localStorage?.setItem(`uniera:${key}`, JSON.stringify(value));
  } catch {
    // full or blocked: the next visit loads from the server
  }
}

export async function readCacheByPrefix<T>(prefix: string): Promise<[string, T][]> {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return [];
    return Object.keys(storage)
      .filter((k) => k.startsWith(`uniera:${prefix}`))
      .map((k) => [k.slice('uniera:'.length), JSON.parse(storage.getItem(k) ?? 'null') as T] as [string, T])
      .filter(([, v]) => v !== null);
  } catch {
    return [];
  }
}

export function forgetCache(key: string) {
  try {
    globalThis.localStorage?.removeItem(`uniera:${key}`);
  } catch {
    // nothing to remove
  }
}

export function clearCache() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    Object.keys(storage)
      .filter((k) => k.startsWith('uniera:'))
      .forEach((k) => storage.removeItem(k));
  } catch {
    // nothing to clear
  }
}
