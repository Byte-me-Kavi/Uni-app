// Gansiya brand tokens (brand kit: "Colour and type"). Red means you, or something to do.
// Text on red is always Ink, never white.

export const colors = {
  red: '#FF5C47',
  ink: '#141414',
  white: '#FFFFFF',
  smoke: '#F3F3F1',
  redTint: '#FFE6E2',
  graphite: '#555555',
  // Surfaces and text on Ink, checked for at least 4.5:1 contrast against Ink.
  inkRaised: '#1F1F1F',
  inkBorder: '#3A3A3A',
  onInkMuted: '#A8A8A8',
} as const;

// PostScript names: identical on Android (embedded file name) and iOS (font's own name).
export const fonts = {
  display: 'Unbounded-ExtraBold',
  body: 'Figtree-Regular',
  bodySemiBold: 'Figtree-SemiBold',
  bodyBold: 'Figtree-Bold',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
