import { StyleSheet } from 'react-native';

import { useScheme, useThemeName, type ThemeName } from '@/theme/appearance';

// Uni Era brand colours. The accent (sky blue by default; students can pick another theme) means
// you, or something to do. Components take the accent from the palette (useTheme / t.accent), not
// from here. Red is kept for errors and for actions that remove or block.
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
  /** The theme's accent: filled buttons, selection, badges, the brand card. */
  accent: string;
  /** Text and icons on the accent (Ink on pale accents, white on deep ones). */
  onAccent: string;
  /** The soft highlight: a pale tint of the accent (nudges, notices). */
  accentTint: string;
  /** Text on the tint. */
  onAccentTint: string;
  /** The large background mark on auth screens: visible as shape, never competing with text. */
  heroMark: string;
  /** The accent where it stands alone (icons, outlines, small text): pale accents are too light on
   * white, so light mode uses a deeper shade of the same hue. Filled buttons and badges use accent. */
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
  /** Read ticks: an accent deep enough to see at 15 px on your bubble. */
  tickRead: string;
  statusBar: 'light' | 'dark';
};

type AccentPart = 'accent' | 'onAccent' | 'accentTint' | 'onAccentTint' | 'accentText' | 'bubbleMine' | 'tickRead';

// The neutral light and dark bases. Contrast checked against each background: body and muted text
// at least 4.5:1 (WCAG AA).
const neutral: Record<'light' | 'dark', Omit<Palette, AccentPart>> = {
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
    errorBg: brand.dangerTint,
    errorText: brand.ink,
    infoBg: brand.smoke,
    infoText: brand.ink,
    scrim: 'rgba(20, 20, 20, 0.55)',
    elevated: brand.white,
    elevatedPressed: brand.smoke,
    bubbleTheirs: brand.smoke,
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
    dangerText: brand.danger, // 6.9:1 on black
    errorBg: '#331410',
    errorText: '#FFD3CC',
    infoBg: '#1C1C1C',
    infoText: brand.white,
    // Darker than in light mode: white text behind a black scrim stays readable much longer.
    scrim: 'rgba(0, 0, 0, 0.78)',
    elevated: '#1F1F1F',
    elevatedPressed: '#2A2A2A',
    bubbleTheirs: '#1C1C1C',
    statusBar: 'light',
  },
};

type Look = Pick<Palette, AccentPart> & Partial<Palette>;
export type Theme = { label: string; light: Look; dark: Look };

// The colour themes (Profile -> Display -> Theme). Each has the accent for buttons and selection, the
// colour on it, a deeper accent for small text on the page, a pale tint, and your chat bubble.
// Checked: onAccent on the accent at least 5.6:1; accentText on the background at least 5:1; body and
// muted text on every background at least 6:1.
export const THEMES: Record<ThemeName, Theme> = {
  sky: {
    label: 'Sky',
    light: {
      accent: '#38BDF8',
      onAccent: brand.ink, // 8.6:1
      accentTint: brand.accentTint,
      onAccentTint: brand.ink,
      accentText: '#0369A1', // 5.9:1 on white
      bubbleMine: brand.accentTint,
      tickRead: '#0369A1',
    },
    dark: {
      accent: '#38BDF8',
      onAccent: brand.ink,
      accentTint: brand.accentTint,
      onAccentTint: brand.ink,
      accentText: '#38BDF8', // 9.8:1 on black
      bubbleMine: '#0B2A3D',
      tickRead: '#38BDF8',
    },
  },
  lime: {
    label: 'Lime',
    light: {
      accent: '#B4D62A',
      onAccent: brand.ink, // 11:1
      accentTint: '#EEF6CF',
      onAccentTint: brand.ink,
      accentText: '#4D6B0B', // 5.8:1
      bubbleMine: '#EEF6CF',
      tickRead: '#4D6B0B',
      // A softer, warmer white than Sky.
      background: '#F8F8F3',
      surface: '#ECECE5',
      surfaceFocused: '#FFFFFF',
      border: '#DADAD1',
      heroMark: '#EAEAE2',
      infoBg: '#ECECE5',
      elevated: '#FFFFFF',
      elevatedPressed: '#ECECE5',
      bubbleTheirs: '#ECECE5',
    },
    dark: {
      accent: '#B4D62A',
      onAccent: brand.ink,
      accentTint: '#EEF6CF',
      onAccentTint: brand.ink,
      accentText: '#C3E048', // 14:1
      bubbleMine: '#1E260A',
      tickRead: '#C3E048',
    },
  },
  cream: {
    label: 'Cream',
    light: {
      accent: '#B3203A',
      onAccent: brand.white, // 6.6:1 (white on deep crimson)
      accentTint: '#F8E1E4',
      onAccentTint: brand.ink,
      accentText: '#A01C33', // 7.4:1 on cream
      bubbleMine: '#F6E3DF',
      tickRead: '#A01C33',
      // Warm cream paper.
      background: '#FFF8EE',
      surface: '#F3EADD',
      surfaceFocused: '#FFFCF7',
      border: '#E3D7C5',
      borderFilled: '#B9AD9C',
      heroMark: '#F2E8D9',
      infoBg: '#F3EADD',
      elevated: '#FFFCF7',
      elevatedPressed: '#F3EADD',
      bubbleTheirs: '#F3EADD',
      textMuted: '#5A5148', // 7.4:1 on cream
    },
    dark: {
      accent: '#C42A45',
      onAccent: brand.white, // 5.6:1
      accentTint: '#F8E1E4',
      onAccentTint: brand.ink,
      accentText: '#FB7185', // 7.3:1
      bubbleMine: '#3A1219',
      tickRead: '#FB7185',
      // Warm black.
      background: '#0F0B08',
      surface: '#1B1611',
      surfaceFocused: '#241D17',
      border: '#352C24',
      borderFilled: '#665A4D',
      heroMark: '#211A14',
      infoBg: '#1B1611',
      elevated: '#241D17',
      elevatedPressed: '#2E261F',
      bubbleTheirs: '#1B1611',
      textMuted: '#ADA196', // 7.8:1
    },
  },
  mint: {
    label: 'Mint',
    light: {
      accent: '#34D399',
      onAccent: brand.ink, // 9.6:1
      accentTint: '#D7F7EA',
      onAccentTint: brand.ink,
      accentText: '#047857', // 5.5:1
      bubbleMine: '#D7F7EA',
      tickRead: '#047857',
    },
    dark: {
      accent: '#34D399',
      onAccent: brand.ink,
      accentTint: '#D7F7EA',
      onAccentTint: brand.ink,
      accentText: '#34D399',
      bubbleMine: '#0A2A1F',
      tickRead: '#34D399',
    },
  },
  lavender: {
    label: 'Lavender',
    light: {
      accent: '#A78BFA',
      onAccent: brand.ink, // 6.8:1
      accentTint: '#EDE7FE',
      onAccentTint: brand.ink,
      accentText: '#6D28D9', // 7.1:1
      bubbleMine: '#EDE7FE',
      tickRead: '#6D28D9',
    },
    dark: {
      accent: '#A78BFA',
      onAccent: brand.ink,
      accentTint: '#EDE7FE',
      onAccentTint: brand.ink,
      accentText: '#B9A2FB',
      bubbleMine: '#221A3D',
      tickRead: '#B9A2FB',
    },
  },
  sunset: {
    label: 'Sunset',
    light: {
      accent: '#FB923C',
      onAccent: brand.ink, // 8.1:1
      accentTint: '#FFE8D5',
      onAccentTint: brand.ink,
      accentText: '#B45309', // 5.0:1
      bubbleMine: '#FFE8D5',
      tickRead: '#B45309',
    },
    dark: {
      accent: '#FB923C',
      onAccent: brand.ink,
      accentTint: '#FFE8D5',
      onAccentTint: brand.ink,
      accentText: '#FB923C',
      bubbleMine: '#33190A',
      tickRead: '#FB923C',
    },
  },
};

const built = new Map<string, Palette>();

export function paletteFor(name: ThemeName, scheme: 'light' | 'dark'): Palette {
  const key = `${name}:${scheme}`;
  let palette = built.get(key);
  if (!palette) {
    palette = { ...neutral[scheme], ...THEMES[name][scheme] } as Palette;
    built.set(key, palette);
  }
  return palette;
}

/** The default theme (Sky), for code outside components. */
export const palettes: Record<'light' | 'dark', Palette> = { light: paletteFor('sky', 'light'), dark: paletteFor('sky', 'dark') };

export function useTheme(): Palette {
  return paletteFor(useThemeName(), useScheme());
}

// Builds a stylesheet the first time a theme and scheme are drawn, and hands back the one matching
// the current settings. No style objects are created during render.
export function createThemedStyles<T extends StyleSheet.NamedStyles<T>>(build: (p: Palette) => T) {
  const sheets = new Map<string, T>();
  return function useThemedStyles() {
    const name = useThemeName();
    const scheme = useScheme();
    const key = `${name}:${scheme}`;
    let sheet = sheets.get(key);
    if (!sheet) {
      sheet = StyleSheet.create(build(paletteFor(name, scheme)));
      sheets.set(key, sheet);
    }
    return sheet;
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
