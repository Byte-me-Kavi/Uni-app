export type AccountStatus = 'pending' | 'active' | 'rejected' | 'suspended';
export type StaffRole = 'moderator' | 'admin' | null;

export type AppClaims = {
  accountStatus: AccountStatus;
  institutionId: number | null;
  staffRole: StaffRole;
  /** False until the student types their name, on first launch after approval. */
  nameConfirmed: boolean;
};

const STATUSES: readonly AccountStatus[] = ['pending', 'active', 'rejected', 'suspended'];

// Reads the claims our custom_access_token hook adds, for routing only. The token is not verified
// here and does not need to be: every permission is enforced by the database, never by these values.
export function readAppClaims(accessToken: string): AppClaims {
  const fallback: AppClaims = { accountStatus: 'pending', institutionId: null, staffRole: null, nameConfirmed: false };
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
    };
  } catch {
    return fallback;
  }
}
