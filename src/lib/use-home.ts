import { useCallback, useEffect, useState } from 'react';

import { readCache, writeCache } from '@/lib/cache';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';

export type MyHome = {
  full_name: string;
  avatar_path: string | null;
  account_status: 'pending' | 'active' | 'rejected' | 'suspended';
  institution: { name: string; short_name: string | null };
  staff_role: 'admin' | 'moderator' | null;
  has_cohort: boolean;
  /** name: "UCSC · BSc in Computer Science · 2023", unique across universities. */
  batch: { name: string; programme: string; intake_year: number; members: number } | null;
  module_count: number;
  /** Accounts waiting for approval in the caller's staff scope; null for students. */
  pending_accounts: number | null;
};

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; home: MyHome };

// Loads everything the home screen needs in one request (api.my_home). The last copy on the phone
// shows at once, so the app opens straight onto a filled home screen and refreshes behind it.
export function useHome() {
  const session = useSession();
  const cacheKey = session.status === 'signed_in' ? `${session.session.user.id}:home` : null;
  const [state, setState] = useState<State>(() => {
    const cached = cacheKey ? readCache<MyHome>(cacheKey) : null;
    return cached ? { status: 'ready', home: cached } : { status: 'loading' };
  });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_home');
    if (error || !data) {
      setState((s) => (s.status === 'ready' ? s : { status: 'error' }));
      return false;
    }
    setState({ status: 'ready', home: data as MyHome });
    if (cacheKey) writeCache(cacheKey, data);
    return true;
  }, [cacheKey]);

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
