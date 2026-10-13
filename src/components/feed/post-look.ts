import type { ComponentType } from 'react';
import { HouseIcon } from 'phosphor-react-native/src/icons/House';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { HandHeartIcon } from 'phosphor-react-native/src/icons/HandHeart';
import { MegaphoneIcon } from 'phosphor-react-native/src/icons/Megaphone';
import { QuestionIcon } from 'phosphor-react-native/src/icons/Question';

import type { LostFoundDetails, Post } from '@/lib/feed';
import type { Palette } from '@/theme/tokens';

type Icon = ComponentType<{ size?: number; weight?: 'regular' | 'bold' | 'fill'; color?: string }>;

/** How a kind of post looks: a solid colour for its badge and buttons (white text on it is at least
 * 5:1), and a tint for the band at the top of the card (the badge's colour as text on it is at least
 * 4.5:1, light and dark). */
export type Look = { key: string; label: string; Icon: Icon; solid: string; onSolid: string; tint: string; text: string };

const TONES = {
  light: {
    question: { tint: '#FDF0D3', text: '#8A4B00' },
    lost: { tint: '#FDE3E8', text: '#A11236' },
    found: { tint: '#DDF3E9', text: '#05694C' },
    bodim: { tint: '#E6E8FD', text: '#3730A3' },
  },
  dark: {
    question: { tint: '#33240C', text: '#F7C268' },
    lost: { tint: '#3A1220', text: '#F7A1B6' },
    found: { tint: '#0C2C22', text: '#76DDB7' },
    bodim: { tint: '#1C1C44', text: '#B3B6FA' },
  },
} as const;

// Amber 700, rose 700, emerald 700 and indigo 700: deep enough for white labels in both modes.
const SOLID = { question: '#B45309', lost: '#BE123C', found: '#047857', bodim: '#4338CA' } as const;

/** The look of a post's kind, or null for a plain post. */
export function lookOf(
  post: Pick<Post, 'tag' | 'details' | 'notice_from'>,
  theme: Palette,
  scheme: 'light' | 'dark',
): Look | null {
  const tone = TONES[scheme];
  switch (post.tag) {
    case 'question':
      return {
        key: 'question',
        label: 'Question',
        Icon: QuestionIcon,
        solid: SOLID.question,
        onSolid: '#FFFFFF',
        ...tone.question,
      };
    case 'lost_found':
      return (post.details as LostFoundDetails | null)?.kind === 'found'
        ? { key: 'found', label: 'Found', Icon: HandHeartIcon, solid: SOLID.found, onSolid: '#FFFFFF', ...tone.found }
        : { key: 'lost', label: 'Lost', Icon: MagnifyingGlassIcon, solid: SOLID.lost, onSolid: '#FFFFFF', ...tone.lost };
    case 'bodim':
      return { key: 'bodim', label: 'Bodim', Icon: HouseIcon, solid: SOLID.bodim, onSolid: '#FFFFFF', ...tone.bodim };
    case 'notice':
      // The theme's own accent: a notice is "from us".
      return {
        key: 'notice',
        label: 'Notice',
        Icon: MegaphoneIcon,
        solid: theme.accent,
        onSolid: theme.onAccent,
        tint: theme.accentTint,
        text: theme.onAccentTint,
      };
    default:
      return null;
  }
}
