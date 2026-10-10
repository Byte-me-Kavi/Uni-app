import { StyleSheet, useColorScheme } from 'react-native';

// Uni Era brand colours (brand kit: "Colour and type"). Red means you, or something to do.
// Text on red is always Ink, in both themes.
export const brand = {
  red: '#FF5C47',
  ink: '#141414',
  white: '#FFFFFF',
  smoke: '#F3F3F1',
  redTint: '#FFE6E2',
  graphite: '#555555',
} as const;

export type Palette = {
  background: string;
  surface: string;
  surfaceFocused: string;
  border: string;
  borderFilled: string;
  focus: string;
  text: string;
  textMuted: string;
  /** The large background mark on auth screens: visible as shape, never competing with text. */
  heroMark: string;
  /** Error text. Brand red is too light on white for small text, so light mode uses a deeper red. */
  dangerText: string;
  errorBg: string;
  errorText: string;
  infoBg: string;
  infoText: string;
  statusBar: 'light' | 'dark';
};

// Contrast checked against each background: body and muted text at least 4.5:1 (WCAG AA).
export const palettes: Record<'light' | 'dark', Palette> = {
  light: {
    background: brand.white,
    surface: brand.smoke,
    surfaceFocused: brand.white,
    border: '#DEDED9',
    borderFilled: '#B3B3AE',
    focus: brand.ink,
    text: brand.ink,
    textMuted: brand.graphite, // 7.5:1 on white
    heroMark: '#EDEDE9',
    dangerText: '#C2311E', // 5.6:1 on white
    errorBg: brand.redTint,
    errorText: brand.ink,
    infoBg: brand.smoke,
    infoText: brand.ink,
    statusBar: 'dark',
  },
  dark: {
    background: '#000000',
    surface: brand.ink,
    surfaceFocused: '#1C1C1C',
    border: '#2E2E2E',
    borderFilled: '#5A5A5A',
    focus: brand.white,
    text: brand.white,
    textMuted: '#A3A3A3', // 8.6:1 on black
    heroMark: '#1F1F1F',
    dangerText: brand.red, // 6.9:1 on black
    errorBg: '#331410',
    errorText: '#FFD3CC',
    infoBg: '#1C1C1C',
    infoText: brand.white,
    statusBar: 'light',
  },
};

export function useTheme(): Palette {
  return useColorScheme() === 'dark' ? palettes.dark : palettes.light;
}

// Builds a stylesheet for each theme once, at module load, and hands back the one matching the
// phone's current setting. No style objects are created during render.
export function createThemedStyles<T extends StyleSheet.NamedStyles<T>>(build: (p: Palette) => T) {
  const sheets = {
    light: StyleSheet.create(build(palettes.light)),
    dark: StyleSheet.create(build(palettes.dark)),
  };
  return function useThemedStyles() {
    return useColorScheme() === 'dark' ? sheets.dark : sheets.light;
  };
}

// PostScript names: identical on Android (embedded file name) and iOS (the font's own name).
// Nunito's rounded terminals carry the friendly tone; Figtree Black is only for the "uni era"
// wordmark, as in the brand board.
export const fonts = {
  wordmark: 'Figtree-Black',
  display: 'Nunito-ExtraBold',
  body: 'Nunito-Regular',
  bodySemiBold: 'Nunito-SemiBold',
  bodyBold: 'Nunito-Bold',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { sm: 8, md: 14, lg: 18, pill: 999 } as const;
