export type AccountStatus = 'pending' | 'active' | 'rejected' | 'suspended';
export type StaffRole = 'moderator' | 'admin' | null;
export type AccountKind = 'student' | 'fresher';

export type AppClaims = {
  accountStatus: AccountStatus;
  institutionId: number | null;
  staffRole: StaffRole;
  /** False until the student types their name, on first launch after approval. */
  nameConfirmed: boolean;
  /** Freshers signed up with a personal email and have limits until they add their university email. */
  accountKind: AccountKind;
  /** Freshers: when the account stops working without a university email (ms since 1970). */
  fresherUntil: number | null;
  /** A fresher past fresherUntil when this token was read (tokens refresh at least hourly). */
  fresherExpired: boolean;
  /** When the account is due to be deleted (ms since 1970), or null. */
  deletingAt: number | null;
};

const STATUSES: readonly AccountStatus[] = ['pending', 'active', 'rejected', 'suspended'];

// Reads the claims our custom_access_token hook adds, for routing only. The token is not verified
// here and does not need to be: every permission is enforced by the database, never by these values.
export function readAppClaims(accessToken: string): AppClaims {
  const fallback: AppClaims = {
    accountStatus: 'pending',
    institutionId: null,
    staffRole: null,
    nameConfirmed: false,
    accountKind: 'student',
    fresherUntil: null,
    fresherExpired: false,
    deletingAt: null,
  };
  try {
    const part = accessToken.split('.')[1];
    if (!part) return fallback;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const payload = JSON.parse(atob(padded)) as { app_metadata?: Record<string, unknown> };
    const meta = payload.app_metadata ?? {};
    const status = meta.account_status;
    return {
      accountStatus: STATUSES.includes(status as AccountStatus) ? (status as AccountStatus) : 'pending',
      institutionId: typeof meta.institution_id === 'number' ? meta.institution_id : null,
      staffRole: meta.staff_role === 'admin' || meta.staff_role === 'moderator' ? meta.staff_role : null,
      // Tokens issued before this claim existed lack it; they belong to accounts that already have a
      // name in use, and the next refresh (within the hour) brings the real value.
      nameConfirmed: meta.name_confirmed !== false,
      accountKind: meta.account_kind === 'fresher' ? 'fresher' : 'student',
      fresherUntil: typeof meta.fresher_until === 'number' ? meta.fresher_until * 1000 : null,
      fresherExpired:
        meta.account_kind === 'fresher' && typeof meta.fresher_until === 'number' && meta.fresher_until * 1000 < Date.now(),
      deletingAt: typeof meta.deleting_at === 'number' ? meta.deleting_at * 1000 : null,
    };
  } catch {
    return fallback;
  }
}
