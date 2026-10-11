// Times as people read them in a chat app.

/** Microseconds since 1970 from a database timestamp. Read positions are compared exactly: they
 * are message times, which share a millisecond often enough that Date.parse would blur them. */
export function micros(iso: string | null | undefined) {
  if (!iso) return 0;
  const fraction = /\.(\d+)/.exec(iso)?.[1] ?? '';
  return Date.parse(iso.replace(/\.\d+/, '')) * 1000 + Number(fraction.padEnd(6, '0').slice(0, 6));
}

const pad = (n: number) => String(n).padStart(2, '0');
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function clockTime(iso: string) {
  const d = new Date(iso);
  const h = d.getHours();
  return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`;
}

// Chat list: time today, "Yesterday", weekday this week, then the date.
export function listTime(iso: string) {
  const d = new Date(iso);
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / DAY);
  if (days <= 0) return clockTime(iso);
  if (days === 1) return 'Yesterday';
  if (days < 7) return WEEKDAYS[d.getDay()].slice(0, 3);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// Separators between days in a chat.
export function dayLabel(ts: number) {
  const d = new Date(ts);
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return WEEKDAYS[d.getDay()];
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}`;
}

export const sameDay = (a: number, b: number) => startOfDay(new Date(a)) === startOfDay(new Date(b));

// A direct chat's header: "online", or when they were last seen, as in WhatsApp.
export function lastSeen(presence: { online: boolean; last_seen_at: string } | null) {
  if (!presence) return null;
  if (presence.online) return 'online';
  const d = new Date(presence.last_seen_at);
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / DAY);
  if (days <= 0) return `last seen today at ${clockTime(presence.last_seen_at)}`;
  if (days === 1) return `last seen yesterday at ${clockTime(presence.last_seen_at)}`;
  return `last seen ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
