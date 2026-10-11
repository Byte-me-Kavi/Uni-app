import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { readCache, writeCache } from '@/lib/cache';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';

export type Findable = 'everyone' | 'my_institution' | 'nobody';
export type WhoCanMessage = 'everyone' | 'my_institution' | 'my_cohort' | 'nobody';

export type Account = {
  user_id: string;
  full_name: string;
  name_confirmed: boolean;
  email: string;
  bio: string | null;
  avatar_path: string | null;
  institution: { id: number; name: string; short_name: string | null };
  batch: { name: string } | null;
  staff_role: 'admin' | 'moderator' | null;
  findable_by: Findable;
  who_can_message: WhoCanMessage;
  blocked_count: number;
};

// The signed-in student's own profile and settings (api.my_account). Reloads whenever the screen
// comes back into view, so changes made on a settings screen show on return. Starts from the copy
// on the phone, so the profile and settings screens open filled in.
export function useAccount() {
  const session = useSession();
  const cacheKey = session.status === 'signed_in' ? `${session.session.user.id}:account` : null;
  const [account, setAccount] = useState<Account | null>(() => (cacheKey ? readCache<Account>(cacheKey) : null));
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_account');
    if (error || !data) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setAccount(data as Account);
    if (cacheKey) writeCache(cacheKey, data);
  }, [cacheKey]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { account, failed, reload: load, setAccount };
}

export const FINDABLE: { value: Findable; label: string; detail: string }[] = [
  { value: 'everyone', label: 'Every university', detail: 'Any verified student can find you by name' },
  { value: 'my_institution', label: 'My university', detail: 'Only students at your university' },
  { value: 'nobody', label: 'No one', detail: 'You do not appear in search' },
];

export const WHO_CAN_MESSAGE: { value: WhoCanMessage; label: string; detail: string }[] = [
  { value: 'everyone', label: 'Every university', detail: 'Any verified student can start a chat with you' },
  { value: 'my_institution', label: 'My university', detail: 'Only students at your university' },
  { value: 'my_cohort', label: 'My batch', detail: 'Only your batchmates' },
  { value: 'nobody', label: 'No one', detail: 'Nobody can start a new chat with you' },
];

export function labelFor<T extends string>(options: { value: T; label: string }[], value: T | undefined) {
  return options.find((o) => o.value === value)?.label ?? '';
}
