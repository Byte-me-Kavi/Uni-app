// Emoji for reactions and the reaction picker. Plain Unicode, drawn by the phone's own emoji font,
// so they look the same as in WhatsApp on that phone.

/** The quick reactions shown above a message (WhatsApp's set). */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export const EMOJI_GROUPS: { label: string; emoji: string[] }[] = [
  {
    label: 'Smileys',
    emoji: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😋', '😛',
      '😜', '🤪', '😝', '🤗', '🤭', '🫢', '🤫', '🤔', '🫡', '🤐', '🤨', '😐', '😑', '😶', '🫠', '😏', '😒', '🙄',
      '😬', '😮‍💨', '😌', '😔', '😪', '😴', '😷', '🤒', '🤕', '🤢', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎',
      '🤓', '🧐', '😕', '😟', '🙁', '😮', '😯', '😲', '😳', '🥺', '🥹', '😦', '😧', '😨', '😰', '😥', '😢', '😭',
      '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '💀', '💩', '🤡', '👻', '👽',
    ],
  },
  {
    label: 'People',
    emoji: [
      '👍', '👎', '👌', '🤌', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋', '🖐️', '👋',
      '👏', '🙌', '🫶', '👐', '🤲', '🤝', '🙏', '✍️', '💪', '🧠', '👀', '👁️', '👂', '🫂', '🙋', '🙇', '🤦', '🤷',
      '💁', '🙆', '🙅', '🧑‍🎓', '🧑‍🏫', '🧑‍💻', '🧑‍🔬', '🧑‍⚕️', '🧑‍🔧', '🏃', '🚶', '💃',
    ],
  },
  {
    label: 'Hearts',
    emoji: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '💕', '💞', '💓', '💗', '💖', '💘', '💯', '✨', '🔥', '⭐', '🌟', '💫', '🎉', '🎊'],
  },
  {
    label: 'Study',
    emoji: [
      '📚', '📖', '📝', '✏️', '🖊️', '📒', '📓', '📄', '📎', '📌', '📍', '📊', '📈', '📉', '🗂️', '📅', '🗓️', '⏰',
      '⏳', '💻', '🖥️', '⌨️', '🖱️', '📱', '🔋', '💡', '🔬', '🧪', '🧮', '📐', '📏', '🎓', '🏫', '🏆', '🥇', '✅',
      '❌', '⚠️', '❓', '❗', '💬', '📢', '🔔', '🔕',
    ],
  },
  {
    label: 'Food',
    emoji: ['☕', '🍵', '🧋', '🥤', '🍚', '🍛', '🍜', '🍝', '🍕', '🍔', '🍟', '🌭', '🥪', '🌮', '🍰', '🎂', '🍩', '🍪', '🍫', '🍦', '🍎', '🍌', '🥭', '🍍', '🥥'],
  },
  {
    label: 'Places and things',
    emoji: ['🚌', '🚆', '🛺', '🚗', '🏍️', '✈️', '🏖️', '🏝️', '⛰️', '🌧️', '⛅', '☀️', '🌙', '🌈', '⚽', '🏏', '🏸', '🎮', '🎧', '🎵', '🎸', '📷', '🎁', '🛒', '💰', '🇱🇰'],
  },
];

// Emoji code points, modifiers and joiners. Enough to tell an emoji-only message from text without
// Unicode property escapes (which not every JavaScript engine on phones supports).
const EMOJI_PART =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}\u{2900}-\u{297F}\u{3030}\u{303D}\u{3297}\u{3299}\u{00A9}\u{00AE}\u{203C}\u{2049}\u{2122}\u{2139}\u{200D}\u{FE0F}\u{20E3}\u{E0020}-\u{E007F}]/u;
const JOINERS = /[\u{200D}\u{FE0F}\u{20E3}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/u;

/** 1 to 3 when a message is only emoji (shown large, as in WhatsApp), else 0. */
export function emojiOnlyCount(text: string | null | undefined) {
  if (!text) return 0;
  const chars = Array.from(text.replace(/\s/g, ''));
  if (chars.length === 0 || chars.length > 24 || !chars.every((c) => EMOJI_PART.test(c))) return 0;
  // Count pictures: each base character, minus the ones a joiner glues onto the previous one.
  let count = 0;
  let glued = false;
  for (const c of chars) {
    if (c === '‍') {
      glued = true;
      continue;
    }
    if (JOINERS.test(c)) continue;
    // Regional indicator pairs (flags) count once.
    const code = c.codePointAt(0)!;
    if (code >= 0x1f1e6 && code <= 0x1f1ff) {
      count += 0.5;
      continue;
    }
    if (!glued) count += 1;
    glued = false;
  }
  const n = Math.ceil(count);
  return n >= 1 && n <= 3 ? n : 0;
}
