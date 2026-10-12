import { useEffect, useState } from 'react';

import { OrganiseSheet } from '@/components/resources/organise-sheet';
import { loadFolders } from '@/lib/chat-folders';
import type { Message } from '@/lib/chat/types';
import { categoryLabel, loadItem, organiseItem, tagItem, type ItemState } from '@/lib/library';
import { useMyModules } from '@/lib/modules';

type Props = {
  /** The chat message whose document, photo or link is being saved. */
  message: Message | null;
  /** The sender or a rep: may file it for everyone in the chat. */
  canTag: boolean;
  onClose: () => void;
  /** Called with a short confirmation (or error) for the chat's note bar. */
  onDone: (text: string) => void;
};

// "Save to Resources" from a chat message: starts from where the library already filed it (or the
// module its codes point to), and saves it for the student, or for everyone when they may.
export function SaveFromChat({ message, canTag, onClose, onDone }: Props) {
  const { data } = useMyModules();
  const [item, setItem] = useState<ItemState | null>(null);

  useEffect(() => {
    if (!message) return;
    let live = true;
    loadItem(message.id).then(({ item: found, error }) => {
      if (!live) return;
      if (found) setItem(found);
      else {
        onDone(error ?? 'This message has no file or link to save yet. Try again in a moment.');
        onClose();
      }
    });
    return () => {
      live = false;
      setItem(null);
    };
  }, [message, onClose, onDone]);

  const codeOf = (id: number) =>
    data?.batch ? [...data.current, ...data.past.flatMap((p) => p.modules)].find((m) => m.id === id)?.code : undefined;

  return (
    <OrganiseSheet
      visible={!!message && !!item}
      name={item?.title ?? ''}
      moduleId={item?.module_id ?? null}
      category={item?.category ?? 'other'}
      canTag={canTag}
      onClose={onClose}
      onSave={async (moduleId, category, forEveryone) => {
        if (!item) return null;
        const e = forEveryone ? await tagItem(item.id, moduleId, category) : null;
        if (e) return e;
        const e2 = await organiseItem(item.id, { moduleId, category });
        if (e2) return e2;
        loadFolders(item.conversation_id, [item.id], true);
        onDone(`Saved to ${codeOf(moduleId) ?? 'your module'} · ${categoryLabel(category)}`);
        return null;
      }}
    />
  );
}
