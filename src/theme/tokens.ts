import { StyleSheet, useColorScheme } from 'react-native';

// Uni Era brand colours. Sky blue (the accent) means you, or something to do; it pairs with the
// black of dark mode. Text on the accent is always Ink, in both themes. Red is kept for errors and
// for actions that remove or block.
export const brand = {
  accent: '#38BDF8',
  /** Errors, Delete, Block, Report. */
  danger: '#FF5C47',
  ink: '#141414',
  white: '#FFFFFF',
  smoke: '#F3F3F1',
  accentTint: '#E0F2FE',
  dangerTint: '#FFE6E2',
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
  /** The accent where it stands alone (icons, outlines, small text): sky blue is too pale on white,
   * so light mode uses a deeper blue of the same hue. Filled buttons and badges use brand.accent. */
  accentText: string;
  /** Error text. The danger red is too light on white for small text, so light mode uses a deeper red. */
  dangerText: string;
  errorBg: string;
  errorText: string;
  infoBg: string;
  infoText: string;
  /** Behind sheets and dialogs: hides the page enough that the sheet is the only thing to read. */
  scrim: string;
  /** Sheets and dialogs: lifted off the page (white in light mode, a lighter grey in dark). */
  elevated: string;
  elevatedPressed: string;
  /** Chat bubbles. Yours carry a tint of the accent (it means you); text in both is the normal text
   * colour, so long messages read as easily as anything else in the app. */
  bubbleMine: string;
  bubbleTheirs: string;
  /** ✓✓ once read: an accent deep enough to see at 15 px on your bubble. */
  tickRead: string;
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
    accentText: '#0369A1', // 5.9:1 on white
    dangerText: '#C2311E', // 5.6:1 on white
    errorBg: brand.dangerTint,
    errorText: brand.ink,
    infoBg: brand.smoke,
    infoText: brand.ink,
    scrim: 'rgba(20, 20, 20, 0.55)',
    elevated: brand.white,
    elevatedPressed: brand.smoke,
    bubbleMine: brand.accentTint, // ink 16:1, muted 6.5:1
    bubbleTheirs: brand.smoke,
    tickRead: '#0369A1', // 5.2:1 on the tint
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
    accentText: brand.accent, // 9.8:1 on black
    dangerText: brand.danger, // 6.9:1 on black
    errorBg: '#331410',
    errorText: '#FFD3CC',
    infoBg: '#1C1C1C',
    infoText: brand.white,
    // Darker than in light mode: white text behind a black scrim stays readable much longer.
    scrim: 'rgba(0, 0, 0, 0.78)',
    elevated: '#1F1F1F',
    elevatedPressed: '#2A2A2A',
    bubbleMine: '#0B2A3D', // white 14.9:1, muted 5.9:1
    bubbleTheirs: '#1C1C1C',
    tickRead: brand.accent, // 6.9:1 on the tint
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
