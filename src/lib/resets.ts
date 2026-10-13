// What each module forgets on sign-out. A module holding an account's data in memory registers a
// reset when it loads; signOut() runs them all, so the next account on the phone starts clean.

const resets = new Set<() => void>();

export function onSignOut(reset: () => void) {
  resets.add(reset);
}

export function runSignOutResets() {
  for (const reset of resets) {
    try {
      reset();
    } catch (error) {
      console.warn('[sign-out] a reset failed', error);
    }
  }
}
