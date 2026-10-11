import { useState } from 'react';
import { FlatList, Text, TextInput } from 'react-native';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { CircleIcon } from 'phosphor-react-native/src/icons/Circle';

import { ChatIcon } from '@/components/chat/chat-row';
import { ModalScreen } from '@/components/chat/modal-screen';
import { PressableScale } from '@/components/ui/pressable-scale';
import { useChatState } from '@/lib/chat/store';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

const LIMIT = 5; // as in WhatsApp: forwarding is for sharing, not broadcasting

// Choosing up to 5 chats to forward to.
export function ForwardPicker({ visible, onClose, onSend }: { visible: boolean; onClose: () => void; onSend: (ids: string[]) => void }) {
  const theme = useTheme();
  const styles = useStyles();
  const chats = useChatState((s) => s.chats).filter((c) => !c.request);
  const [chosen, setChosen] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const shown = query.trim() ? chats.filter((c) => (c.title ?? '').toLowerCase().includes(query.trim().toLowerCase())) : chats;

  function close() {
    setChosen([]);
    setQuery('');
    onClose();
  }

  return (
    <ModalScreen
      visible={visible}
      title={chosen.length ? `Forward to ${chosen.length}` : 'Forward to'}
      onClose={close}
      action={{
        label: 'Send',
        disabled: chosen.length === 0,
        onPress: () => {
          onSend(chosen);
          setChosen([]);
          setQuery('');
        },
      }}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search chats"
        placeholderTextColor={theme.textMuted}
        style={styles.search}
        selectionColor={brand.accent}
        accessibilityLabel="Search chats"
      />
      <FlatList
        data={shown}
        keyExtractor={(c) => c.conversation_id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const on = chosen.includes(item.conversation_id);
          const full = !on && chosen.length >= LIMIT;
          return (
            <PressableScale
              onPress={() =>
                setChosen((c) => (on ? c.filter((x) => x !== item.conversation_id) : full ? c : [...c, item.conversation_id]))
              }
              disabled={full}
              scale={0.985}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: full }}
              accessibilityLabel={item.title ?? 'Chat'}
              style={[styles.row, full && styles.rowFull]}>
              <ChatIcon chat={item} size={44} />
              <Text style={styles.title} numberOfLines={1}>
                {item.title}
              </Text>
              {on ? <CheckCircleIcon size={24} color={theme.tickRead} weight="fill" /> : <CircleIcon size={24} color={theme.textMuted} />}
            </PressableScale>
          );
        }}
      />
      {chosen.length >= LIMIT ? <Text style={styles.note}>You can forward to {LIMIT} chats at a time.</Text> : null}
    </ModalScreen>
  );
}

const useStyles = createThemedStyles((t) => ({
  search: {
    margin: space.md,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: t.surface,
    paddingHorizontal: space.lg,
    fontFamily: fonts.body,
    fontSize: 16,
    color: t.text,
  },
  list: { paddingHorizontal: space.md, paddingBottom: space.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.md },
  rowFull: { opacity: 0.45 },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  note: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: t.textMuted, textAlign: 'center', padding: space.md },
}));

