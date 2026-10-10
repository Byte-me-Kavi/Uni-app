// Client-side checks give instant feedback. The server enforces the same rules (Supabase Auth
// password policy and our before_user_created hook), so these are never the only line of defence.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(value: string) {
  return value.trim().toLowerCase();
}

export function emailError(value: string): string | null {
  return EMAIL.test(normaliseEmail(value)) ? null : 'Enter your university email address.';
}

export function newPasswordError(value: string): string | null {
  if (value.length < 10) return 'Use at least 10 characters.';
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'Include both letters and numbers.';
  return null;
}

// Same rule as api.set_my_name: 2 to 80 characters, letters in any script, spaces, dots,
// apostrophes and hyphens.
export function fullNameError(value: string): string | null {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) return 'Enter your name (2 to 80 characters).';
  if (/[\d@#$%^&*_=+<>/\\|{}~`!?:;"[\]]/.test(name)) return 'Use letters only: your name as it is at your university.';
  return null;
}
