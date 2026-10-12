import { Linking } from 'react-native';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { readCache, writeCache } from '@/lib/cache';
import { signedUrl } from '@/lib/chat/media-urls';
import { offlineCopy, openFile } from '@/lib/chat/transfer';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';

// The student's library: documents, photos and links from their chats, filed into module folders
// by the server (see the library migration). Folders are read page by page; the counts on the
// Resources tab come from one overview request and are kept on the phone.

export type Category = 'slides' | 'notes' | 'past_papers' | 'tutorials' | 'assignments' | 'videos' | 'links' | 'photos' | 'other';

export const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'slides', label: 'Lecture slides' },
  { key: 'notes', label: 'Notes' },
  { key: 'past_papers', label: 'Past papers' },
  { key: 'tutorials', label: 'Tutorials and labs' },
  { key: 'assignments', label: 'Assignments' },
  { key: 'videos', label: 'Videos' },
  { key: 'links', label: 'Links' },
  { key: 'photos', label: 'Photos' },
  { key: 'other', label: 'Other files' },
];

export const categoryLabel = (c: Category) => CATEGORIES.find((x) => x.key === c)?.label ?? 'Other files';

export type LibraryItem = {
  /** The message it came from. */
  id: string;
  conversation_id: string;
  chat_kind: 'direct' | 'group' | 'cohort' | 'programme' | 'module' | 'kuppi';
  chat_title?: string;
  sender_name?: string;
  kind: 'file' | 'image' | 'link';
  title: string;
  path?: string;
  mime?: string;
  size?: number;
  url?: string;
  thumb?: string;
  site?: string;
  category: Category;
  paper_year?: number;
  created_at: string;
  pinned: boolean;
  module_id?: number;
  /** To sort: this semester's module whose name is closest. */
  suggested_module_id?: number | null;
  /** The student sent it (or is a rep of its batch group) and may share it with the university. */
  can_share?: boolean;
  /** Search: the line inside the file that matched. */
  snippet?: string;
};

export type ModuleFolder = {
  module: { id: number; code: string; name: string };
  folders: { category: Category; count: number }[] | null;
  pinned: LibraryItem[] | null;
  items: LibraryItem[];
};

export type Overview = { modules: { module_id: number; count: number; new: number }[]; to_sort: number };

// ---------------------------------------------------------------------------------------------
// Overview (shared by the Resources tab and the screens that change it)
// ---------------------------------------------------------------------------------------------

type OverviewState = { key: string | null; data: Overview | null };
let overview: OverviewState = { key: null, data: null };
const overviewListeners = new Set<() => void>();
let overviewLoading: Promise<void> | null = null;

function setOverview(next: OverviewState) {
  overview = next;
  overviewListeners.forEach((l) => l());
}

/** Reloads the counts (after filing something, or when the tab is opened). */
export function refreshOverview() {
  if (overviewLoading) return overviewLoading;
  overviewLoading = (async () => {
    const { data, error } = await supabase.rpc('library_overview');
    if (!error && data) {
      setOverview({ key: overview.key, data: data as Overview });
      if (overview.key) writeCache(overview.key, data);
    }
  })().finally(() => {
    overviewLoading = null;
  });
  return overviewLoading;
}

export function useLibraryOverview() {
  const session = useSession();
  const key = session.status === 'signed_in' ? `${session.session.user.id}:library` : null;
  const snapshot = useSyncExternalStore(
    (l) => {
      overviewListeners.add(l);
      return () => overviewListeners.delete(l);
    },
    () => overview,
  );
  useEffect(() => {
    if (overview.key !== key) setOverview({ key, data: key ? readCache<Overview>(key) : null });
    if (key) refreshOverview();
  }, [key]);
  if (snapshot.key === key) return snapshot.data;
  return key ? readCache<Overview>(key) : null;
}

// ---------------------------------------------------------------------------------------------
// A module's folder
// ---------------------------------------------------------------------------------------------

const PAGE = 40;

/** One module's library, optionally one category, newest first, with "load more". */
export function useModuleLibrary(moduleId: number, category: Category | null) {
  const session = useSession();
  const cacheKey =
    session.status === 'signed_in' ? `${session.session.user.id}:lib:${moduleId}:${category ?? 'all'}` : null;
  const [data, setData] = useState<ModuleFolder | null>(() => (cacheKey ? readCache<ModuleFolder>(cacheKey) : null));
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(data ? 'ready' : 'loading');
  const [more, setMore] = useState(true);
  const busy = useRef(false);

  const fetchFirst = useCallback(
    () => supabase.rpc('library', { p_module_id: moduleId, ...(category ? { p_category: category } : {}), p_limit: PAGE }),
    [moduleId, category],
  );
  const apply = useCallback(
    ({ data: page, error }: { data: unknown; error: unknown }) => {
      if (error || !page) {
        setStatus((s) => (s === 'ready' ? s : 'error'));
        return;
      }
      const folder = page as ModuleFolder;
      setData(folder);
      setMore(folder.items.length === PAGE);
      setStatus('ready');
      if (cacheKey) writeCache(cacheKey, folder);
    },
    [cacheKey],
  );

  useEffect(() => {
    let live = true;
    fetchFirst().then((result) => live && apply(result));
    return () => {
      live = false;
    };
  }, [fetchFirst, apply]);

  const load = useCallback(() => fetchFirst().then(apply), [fetchFirst, apply]);

  const loadMore = useCallback(async () => {
    if (busy.current || !more || !data?.items.length) return;
    busy.current = true;
    const last = data.items[data.items.length - 1];
    const { data: page } = await supabase.rpc('library', {
      p_module_id: moduleId,
      ...(category ? { p_category: category } : {}),
      p_before: last.created_at,
      p_limit: PAGE,
    });
    busy.current = false;
    if (!page) return;
    const next = (page as ModuleFolder).items;
    setData((d) => (d ? { ...d, items: [...d.items, ...next] } : d));
    setMore(next.length === PAGE);
  }, [data, more, moduleId, category]);

  return { data, status, more, reload: load, loadMore };
}

export async function loadToSort() {
  const { data, error } = await supabase.rpc('library_to_sort', { p_limit: 100 });
  if (error) return { items: null, error: error.message };
  return { items: (data ?? []) as LibraryItem[], error: null };
}

// ---------------------------------------------------------------------------------------------
// Changing
// ---------------------------------------------------------------------------------------------

export type Organise = { moduleId?: number; category?: Category; pinned?: boolean; hidden?: boolean };

/** Files an item for the student. Returns an error message or null. */
export async function organiseItem(messageId: string, change: Organise) {
  const { error } = await supabase.rpc('organise_item', {
    p_message_id: messageId,
    ...(change.moduleId !== undefined ? { p_module_id: change.moduleId } : {}),
    ...(change.category !== undefined ? { p_category: change.category } : {}),
    ...(change.pinned !== undefined ? { p_pinned: change.pinned } : {}),
    ...(change.hidden !== undefined ? { p_hidden: change.hidden } : {}),
  });
  if (error) return error.message;
  refreshOverview();
  return null;
}

/** The sender or a rep files an item for everyone in the chat. */
export async function tagItem(messageId: string, moduleId: number, category: Category) {
  const { error } = await supabase.rpc('tag_item', { p_message_id: messageId, p_module_id: moduleId, p_category: category });
  if (error) return error.message;
  refreshOverview();
  return null;
}

export type ItemState = LibraryItem & { in_library: boolean; saved: boolean };

/** How a chat message's file or link is filed for the student; null if it holds none. */
export async function loadItem(messageId: string) {
  const { data, error } = await supabase.rpc('library_item', { p_message_id: messageId });
  if (error) return { item: null, error: error.message };
  return { item: (data ?? null) as ItemState | null, error: null };
}

// ---------------------------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------------------------

/** Opens a document in the phone's viewer or a link in the browser. Photos open in the app's
 * viewer instead (see the module screen). Returns an error message or null. */
export async function openItem(item: LibraryItem) {
  try {
    if (item.kind === 'link' && item.url) {
      if (!/^https?:\/\//i.test(item.url)) return 'This link cannot be opened.';
      await Linking.openURL(item.url);
      return null;
    }
    if (!item.path) return 'This file cannot be opened.';
    // A copy kept for offline opens without the network.
    const kept = await offlineCopy({ path: item.path, name: item.title });
    const url = kept ? '' : ((await signedUrl(item.path)) ?? '');
    if (!url && !kept) return 'Could not open. Check your connection and try again.';
    await openFile({ url, path: item.path, name: item.title, mime: item.mime ?? 'application/octet-stream' });
    return null;
  } catch {
    return 'Could not open. Check your connection and try again.';
  }
}

/** "Batch group · Nimal · 3 Mar": where an item came from. */
export function itemSource(item: LibraryItem) {
  const where =
    item.chat_kind === 'direct'
      ? 'Direct message'
      : item.chat_kind === 'module'
        ? 'Course chat'
        : item.chat_kind === 'cohort'
          ? 'Batch group'
          : item.chat_kind === 'kuppi'
            ? 'Kuppi chat'
            : (item.chat_title ?? 'Group');
  const when = new Date(item.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return [where, item.sender_name, when].filter(Boolean).join(' · ');
}

/** Searches the student's own library by name or module code. */
export async function searchLibrary(query: string) {
  const { data, error } = await supabase.rpc('library_search', { p_query: query.trim(), p_limit: 40 });
  if (error) return { items: null, error: error.message };
  return { items: (data ?? []) as LibraryItem[], error: null };
}
