import { router } from 'expo-router';
import { useCallback, useState } from 'react';

import { MediaViewer } from '@/components/chat/media-viewer';
import { OrganiseSheet } from '@/components/resources/organise-sheet';
import { ActionSheet, type SheetAction } from '@/components/ui/action-sheet';
import { openChat } from '@/lib/chat/open-chat';
import type { Message } from '@/lib/chat/types';
import { openItem, organiseItem, type LibraryItem } from '@/lib/library';

// A photo from the library shown in the chat photo viewer.
function asMessage(item: LibraryItem): Message {
  return {
    id: item.id,
    conversation_id: item.conversation_id,
    sender_id: null,
    sender_name: item.sender_name ?? null,
    sender_avatar: null,
    body: item.title === 'Photo' ? null : item.title,
    reply_to_id: null,
    created_at: item.created_at,
    ts: Date.parse(item.created_at),
    status: 'sent',
    error: null,
    deleted: false,
    kind: 'image',
    attachment: { path: item.path, width: 0, height: 0, size: item.size ?? 0, thumb: item.thumb ?? null },
  };
}

/** Opening library items and their menu (move, change folder, pin, show in chat, remove), shared by
 * module folders and To sort. Render `elements` once in the screen. onChanged reloads the list. */
export function useItemControls(onChanged: () => void) {
  const [menuFor, setMenuFor] = useState<LibraryItem | null>(null);
  const [moving, setMoving] = useState<LibraryItem | null>(null);
  const [viewing, setViewing] = useState<LibraryItem | null>(null);
  const [notes, setNotes] = useState<Record<string, string | null>>({});

  const note = (id: string, text: string | null) => setNotes((n) => ({ ...n, [id]: text }));

  const open = useCallback(async (item: LibraryItem) => {
    if (item.kind === 'image') {
      setViewing(item);
      return;
    }
    note(item.id, 'Opening…');
    note(item.id, await openItem(item));
  }, []);

  const more = useCallback((item: LibraryItem) => setMenuFor(item), []);

  async function change(item: LibraryItem, patch: Parameters<typeof organiseItem>[1]) {
    const e = await organiseItem(item.id, patch);
    note(item.id, e);
    if (!e) onChanged();
  }

  const actions: SheetAction[] = menuFor
    ? [
        { label: 'Move or change folder', onPress: () => setMoving(menuFor) },
        menuFor.pinned
          ? { label: 'Unpin', onPress: () => change(menuFor, { pinned: false }) }
          : { label: 'Pin to the top', onPress: () => change(menuFor, { pinned: true }) },
        { label: 'Show in chat', onPress: () => openChat(menuFor.conversation_id, menuFor.id) },
        ...(menuFor.can_share
          ? [
              {
                label: 'Share with your university',
                onPress: () =>
                  router.push({
                    pathname: '/share',
                    params: {
                      message: menuFor.id,
                      title: menuFor.title,
                      category: menuFor.category,
                      ...(menuFor.module_id ? { module: String(menuFor.module_id) } : {}),
                    },
                  }),
              },
            ]
          : []),
        { label: 'Remove from my library', destructive: true, onPress: () => change(menuFor, { hidden: true }) },
      ]
    : [];

  const elements = (
    <>
      <ActionSheet visible={!!menuFor} title={menuFor?.title} actions={actions} onClose={() => setMenuFor(null)} />
      <OrganiseSheet
        visible={!!moving}
        name={moving?.title ?? ''}
        moduleId={moving?.module_id ?? moving?.suggested_module_id ?? null}
        category={moving?.category ?? 'other'}
        onClose={() => setMoving(null)}
        onSave={async (moduleId, category) => {
          if (!moving) return null;
          const e = await organiseItem(moving.id, { moduleId, category });
          if (!e) onChanged();
          return e;
        }}
      />
      <MediaViewer message={viewing ? asMessage(viewing) : null} onClose={() => setViewing(null)} />
    </>
  );

  return { open, more, notes, elements };
}
