import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

export type MyHome = {
  full_name: string;
  account_status: 'pending' | 'active' | 'rejected' | 'suspended';
  institution: { name: string; short_name: string | null };
  staff_role: 'admin' | 'moderator' | null;
  has_cohort: boolean;
  module_count: number;
  /** Accounts waiting for approval in the caller's staff scope; null for students. */
  pending_accounts: number | null;
};

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; home: MyHome };

// Loads everything the home screen needs in one request (api.my_home).
export function useHome() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_home');
    if (error || !data) {
      setState((s) => (s.status === 'ready' ? s : { status: 'error' }));
      return false;
    }
    setState({ status: 'ready', home: data as MyHome });
    return true;
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    load();
  }, [load]);

  return { state, refreshing, refresh, retry };
}

export function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

export function initials(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}
