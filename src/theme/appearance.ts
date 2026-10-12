import { useSyncExternalStore } from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';

import { readCache, writeCache } from '@/lib/cache';

// How the app looks: light or dark (the phone's setting by default, or the student's choice), and a
// colour theme (Profile → Display). Kept on this phone (it is about the screen, not the account), so
// it survives signing out. Native parts (keyboard, alerts, pickers) follow light or dark too.

export type AppearancePref = 'system' | 'light' | 'dark';

export const APPEARANCE_OPTIONS: { key: AppearancePref; label: string }[] = [
  { key: 'system', label: 'Match my phone' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

const KEY = 'device:appearance';
const listeners = new Set<() => void>();

function stored(): AppearancePref {
  const value = readCache<AppearancePref>(KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

function applyNative(p: AppearancePref) {
  if (Platform.OS === 'web') return;
  try {
    Appearance.setColorScheme(p === 'system' ? 'unspecified' : p);
  } catch {
    // Older Android: the app follows the phone.
  }
}

let pref: AppearancePref = stored();
applyNative(pref);

export function setAppearance(next: AppearancePref) {
  if (next === pref) return;
  pref = next;
  applyNative(next);
  writeCache(KEY, next);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppearance(): AppearancePref {
  return useSyncExternalStore(subscribe, () => pref);
}

/** The scheme to draw with: the student's choice, else the phone's. */
export function useScheme(): 'light' | 'dark' {
  const system = useColorScheme();
  const chosen = useAppearance();
  if (chosen !== 'system') return chosen;
  return system === 'dark' ? 'dark' : 'light';
}

// ---------------------------------------------------------------------------------------------
// Colour themes (the colours themselves are in tokens.ts)
// ---------------------------------------------------------------------------------------------

export const THEME_NAMES = ['sky', 'lime', 'cream', 'mint', 'lavender', 'sunset'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

const THEME_KEY = 'device:theme';
const themeListeners = new Set<() => void>();

let theme: ThemeName = (() => {
  const value = readCache<ThemeName>(THEME_KEY);
  return value && (THEME_NAMES as readonly string[]).includes(value) ? value : 'sky';
})();

export function setThemeName(next: ThemeName) {
  if (next === theme) return;
  theme = next;
  writeCache(THEME_KEY, next);
  themeListeners.forEach((l) => l());
}

export function useThemeName(): ThemeName {
  return useSyncExternalStore(
    (listener) => {
      themeListeners.add(listener);
      return () => themeListeners.delete(listener);
    },
    () => theme,
  );
}
