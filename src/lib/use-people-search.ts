import { useEffect, useState } from 'react';

import { onSignOut } from '@/lib/resets';
import { supabase } from '@/lib/supabase';

export type PersonResult = {
  user_id: string;
  full_name: string;
  avatar_path: string | null;
  institution: string;
  programme: string | null;
  intake_year: number | null;
  relation: 'batchmate' | 'university' | null;
  /** True when nothing matched as typed and these are matches for the closest spelling. */
  corrected: boolean;
  /** A student you blocked: listed so you can find them and unblock. */
  blocked: boolean;
};

export type SearchState =
  | { status: 'idle'; results: PersonResult[] }
  | { status: 'loading'; results: PersonResult[] }
  | { status: 'ready'; results: PersonResult[] }
  | { status: 'error'; results: PersonResult[]; message: string };

const LIMIT = 8; // api.search_people returns at most 8
const DEBOUNCE_MS = 120;
const CACHE_SIZE = 60;

// Recent answers for this app session, newest last. Backspacing or retyping a name is instant.
const cache = new Map<string, PersonResult[]>();

// Blocking or unblocking changes results, so the next search asks the server again.
export function clearSearchCache() {
  cache.clear();
}

// Another account may not see the same people (freshers are shielded), so its searches start fresh.
onSignOut(clearSearchCache);

function remember(key: string, results: PersonResult[]) {
  cache.delete(key);
  cache.set(key, results);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
}

// Close to identity.search_text on the server (lower case, punctuation to spaces). Only used for
// cache keys and local narrowing; the server does the real matching.
export function normalise(query: string) {
  return query
    .toLowerCase()
    .replace(/[\s.,;:'"`()/\\_&+%!?@#*-]+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 4)
    .join(' ');
}

// Same rule as the server: every typed word starts some word of the name.
function matches(name: string, query: string) {
  const words = normalise(name).split(' ');
  return query.split(' ').every((q) => words.some((w) => w.startsWith(q)));
}

// A shorter query that came back with fewer than 8 results returned every match, so a longer
// query ("kav" -> "kavi") can only narrow it: filter on the phone instead of asking again.
function narrowFromCache(key: string): PersonResult[] | null {
  for (let i = key.length - 1; i >= 2; i--) {
    const prefix = key.slice(0, i).trimEnd();
    const known = cache.get(prefix);
    if (known && known.length < LIMIT && !known.some((r) => r.corrected)) {
      return known.filter((r) => matches(r.full_name, key));
    }
  }
  return null;
}

// Students matching the query as it is typed. Waits for a short pause in typing, cancels a
// request as soon as the query changes, and keeps the previous results on screen while the next
// ones load, so the list never flashes empty.
export function usePeopleSearch(query: string): SearchState {
  const key = normalise(query);
  const searchable = key.replace(/ /g, '').length >= 2;
  const [state, setState] = useState<SearchState>({ status: 'idle', results: [] });

  useEffect(() => {
    if (!searchable) {
      setState({ status: 'idle', results: [] });
      return;
    }
    // Narrowing to nothing still asks the server, which may find the name under a corrected spelling.
    const narrowed = cache.has(key) ? null : narrowFromCache(key);
    const known = cache.get(key) ?? (narrowed?.length ? narrowed : null);
    if (known) {
      remember(key, known);
      setState({ status: 'ready', results: known });
      return;
    }

    setState((s) => ({ status: 'loading', results: s.results }));
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc('search_people', { p_query: key }).abortSignal(controller.signal);
      if (controller.signal.aborted) return;
      if (error) {
        const message =
          error.code === 'PT429'
            ? 'Too many searches. Try again in a minute.'
            : 'Could not search right now. Check your connection.';
        setState((s) => ({ status: 'error', results: s.results, message }));
        return;
      }
      const results = (data ?? []) as PersonResult[];
      remember(key, results);
      setState({ status: 'ready', results });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, searchable]);

  return state;
}
