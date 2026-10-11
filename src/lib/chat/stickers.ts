// The built-in sticker pack: Microsoft Fluent Emoji 3D (MIT licence, assets/stickers/fluent/
// LICENSE.txt), 256 px WebP, about 190 KB for the whole pack. Bundled with the app, so stickers
// show instantly and offline, and a sticker message carries only its name.

export const STICKER_PACK = 'fluent';

export const STICKERS = {
  grinning: { label: 'Grinning', source: require('../../../assets/stickers/fluent/grinning.webp') },
  tears_of_joy: { label: 'Tears of joy', source: require('../../../assets/stickers/fluent/tears_of_joy.webp') },
  rofl: { label: 'Rolling on the floor laughing', source: require('../../../assets/stickers/fluent/rofl.webp') },
  heart_eyes: { label: 'Heart eyes', source: require('../../../assets/stickers/fluent/heart_eyes.webp') },
  sunglasses: { label: 'Sunglasses', source: require('../../../assets/stickers/fluent/sunglasses.webp') },
  partying: { label: 'Partying', source: require('../../../assets/stickers/fluent/partying.webp') },
  thinking: { label: 'Thinking', source: require('../../../assets/stickers/fluent/thinking.webp') },
  nerd: { label: 'Nerd', source: require('../../../assets/stickers/fluent/nerd.webp') },
  sleeping: { label: 'Sleeping', source: require('../../../assets/stickers/fluent/sleeping.webp') },
  exploding_head: { label: 'Mind blown', source: require('../../../assets/stickers/fluent/exploding_head.webp') },
  melting: { label: 'Melting', source: require('../../../assets/stickers/fluent/melting.webp') },
  saluting: { label: 'Saluting', source: require('../../../assets/stickers/fluent/saluting.webp') },
  pleading: { label: 'Pleading', source: require('../../../assets/stickers/fluent/pleading.webp') },
  crying: { label: 'Crying', source: require('../../../assets/stickers/fluent/crying.webp') },
  screaming: { label: 'Screaming', source: require('../../../assets/stickers/fluent/screaming.webp') },
  skull: { label: 'Skull', source: require('../../../assets/stickers/fluent/skull.webp') },
  eyes: { label: 'Eyes', source: require('../../../assets/stickers/fluent/eyes.webp') },
  thumbs_up: { label: 'Thumbs up', source: require('../../../assets/stickers/fluent/thumbs_up.webp') },
  clapping: { label: 'Clapping', source: require('../../../assets/stickers/fluent/clapping.webp') },
  folded_hands: { label: 'Thank you', source: require('../../../assets/stickers/fluent/folded_hands.webp') },
  flexed_biceps: { label: 'Strong', source: require('../../../assets/stickers/fluent/flexed_biceps.webp') },
  waving: { label: 'Waving', source: require('../../../assets/stickers/fluent/waving.webp') },
  red_heart: { label: 'Heart', source: require('../../../assets/stickers/fluent/red_heart.webp') },
  fire: { label: 'Fire', source: require('../../../assets/stickers/fluent/fire.webp') },
  hundred: { label: '100', source: require('../../../assets/stickers/fluent/hundred.webp') },
  sparkles: { label: 'Sparkles', source: require('../../../assets/stickers/fluent/sparkles.webp') },
  party_popper: { label: 'Party popper', source: require('../../../assets/stickers/fluent/party_popper.webp') },
  trophy: { label: 'Trophy', source: require('../../../assets/stickers/fluent/trophy.webp') },
  books: { label: 'Books', source: require('../../../assets/stickers/fluent/books.webp') },
  graduation_cap: { label: 'Graduation', source: require('../../../assets/stickers/fluent/graduation_cap.webp') },
  memo: { label: 'Memo', source: require('../../../assets/stickers/fluent/memo.webp') },
  alarm_clock: { label: 'Alarm clock', source: require('../../../assets/stickers/fluent/alarm_clock.webp') },
  hot_beverage: { label: 'Tea', source: require('../../../assets/stickers/fluent/hot_beverage.webp') },
  light_bulb: { label: 'Idea', source: require('../../../assets/stickers/fluent/light_bulb.webp') },
  rocket: { label: 'Rocket', source: require('../../../assets/stickers/fluent/rocket.webp') },
  check_mark: { label: 'Done', source: require('../../../assets/stickers/fluent/check_mark.webp') },
} as const;

export type StickerId = keyof typeof STICKERS;
export const STICKER_IDS = Object.keys(STICKERS) as StickerId[];

export function sticker(pack: string, id: string) {
  return pack === STICKER_PACK ? (STICKERS as Record<string, { label: string; source: number }>)[id] ?? null : null;
}
