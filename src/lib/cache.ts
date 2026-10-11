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

/** On sign-out: nothing of this account stays on the phone. */
export function clearCache() {
  Storage.clearAsync().catch(() => {});
}
