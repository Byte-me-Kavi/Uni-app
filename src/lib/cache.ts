import { Storage } from 'expo-sqlite/kv-store';

// Small things the app shows the moment it opens (your home screen, profile, a group's members),
// kept on the phone from the last visit and refreshed from the server behind them. Reads are
// synchronous so a screen's first frame already has data; writes happen in the background.
// Keys start with the account id, so another account on the same phone never sees them.

export function readCache<T>(key: string): T | null {
  try {
    const raw = Storage.getItemSync(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeCache(key: string, value: unknown) {
  Storage.setItemAsync(key, JSON.stringify(value)).catch(() => {});
}

/** Every key starting with `prefix`, read in the background (for warming an in-memory copy at
 * startup instead of reading one key at a time while a screen draws). Expired entries can be
 * dropped with `forget`. */
export async function readCacheByPrefix<T>(prefix: string): Promise<[string, T][]> {
  const keys = (await Storage.getAllKeysAsync()).filter((k) => k.startsWith(prefix));
  const out: [string, T][] = [];
  for (const k of keys) {
    const raw = await Storage.getItemAsync(k).catch(() => null);
    if (!raw) continue;
    try {
      out.push([k, JSON.parse(raw) as T]);
    } catch {
      // unreadable: skip
    }
  }
  return out;
}

export function forgetCache(key: string) {
  Storage.removeItemAsync(key).catch(() => {});
}

/** On sign-out: nothing of this account stays on the phone. */
export function clearCache() {
  Storage.clearAsync().catch(() => {});
}
