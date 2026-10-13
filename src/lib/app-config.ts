import Constants from 'expo-constants';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import { readCache, writeCache } from '@/lib/cache';
import { supabase } from '@/lib/supabase';

/** The switches in ops.settings (api.app_config). A missing switch counts as on. */
export type Feature = 'posting' | 'shop' | 'uploads' | 'new_dms' | 'kuppi' | 'signup' | 'fresher_signup';

type Config = Record<string, unknown>;

const KEY = 'app-config';
// Read at most this often when the app comes back to the foreground: switches change rarely.
const EVERY_MS = 5 * 60 * 1000;

let config: Config = readCache<Config>(KEY) ?? {};
let fetchedAt = 0;
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Fetches the switches, the minimum version and the notice. Works signed out (anon may call it). */
export async function refreshAppConfig(force = false) {
  if (!force && Date.now() - fetchedAt < EVERY_MS) return;
  fetchedAt = Date.now();
  const { data, error } = await supabase.rpc('app_config');
  if (error || !data || typeof data !== 'object') {
    fetchedAt = 0;
    return;
  }
  config = data as Config;
  writeCache(KEY, config);
  listeners.forEach((fn) => fn());
}

/** Keeps the config fresh: once at launch, then whenever the app comes back to the foreground. */
export function useAppConfigSync() {
  useEffect(() => {
    refreshAppConfig(true);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshAppConfig();
    });
    return () => sub.remove();
  }, []);
}

function useConfig() {
  return useSyncExternalStore(subscribe, () => config);
}

export function useFeature(feature: Feature): boolean {
  return useConfig()[`feature.${feature}`] !== false;
}

/** The message every student sees on Home, set by national admins; null for none. */
export function useNotice(): string | null {
  const notice = useConfig()['app.notice'];
  return typeof notice === 'string' && notice.trim() ? notice : null;
}

export const appVersion = Constants.expoConfig?.version ?? '0.0.0';

function parts(v: string) {
  return v.split('.').map((n) => Number.parseInt(n, 10) || 0);
}

/** True when `version` is older than `min` (both like 1.2.0). */
export function olderThan(version: string, min: string) {
  const a = parts(version);
  const b = parts(min);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

/** True when this build is below app.min_version and must be updated before it can be used. */
export function useUpdateRequired(): boolean {
  const min = useConfig()['app.min_version'];
  return typeof min === 'string' && olderThan(appVersion, min);
}

/** Where to update: the store page for this phone, or null when none is known (iPhone until the
 * App Store listing exists; set app.store_url_ios then). */
export function useStoreUrl(): string | null {
  const c = useConfig();
  if (Platform.OS === 'android') {
    const url = c['app.store_url_android'];
    return typeof url === 'string' ? url : 'https://play.google.com/store/apps/details?id=lk.uniera.app';
  }
  const url = c['app.store_url_ios'];
  return typeof url === 'string' ? url : null;
}
