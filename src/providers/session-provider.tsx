import type { Session } from '@supabase/supabase-js';
import { createContext, use, useEffect, useState, type ReactNode } from 'react';

import { readAppClaims, type AppClaims } from '@/lib/claims';
import { supabase } from '@/lib/supabase';

type SessionState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'signed_in'; session: Session; claims: AppClaims };

const SessionContext = createContext<SessionState>({ status: 'loading' });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    // INITIAL_SESSION fires once with whatever is stored on the device (no network call), then
    // every sign-in, sign-out and token refresh follows. Claims come from the access token.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(
        session
          ? { status: 'signed_in', session, claims: readAppClaims(session.access_token) }
          : { status: 'signed_out' },
      );
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return <SessionContext value={state}>{children}</SessionContext>;
}

export function useSession() {
  return use(SessionContext);
}
