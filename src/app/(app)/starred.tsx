import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { BackHeader } from '@/components/ui/back-header';
import { Avatar } from '@/components/ui/avatar';
import { Screen } from '@/components/ui/screen';
import { previewText } from '@/lib/chat/attachments';
import { listTime } from '@/lib/chat/format';
import { openChat } from '@/lib/chat/open-chat';
import type { Attachment, MessageKind } from '@/lib/chat/types';
import { supabase } from '@/lib/supabase';
import { brand, createThemedStyles, fonts, radius, space } from '@/theme/tokens';

type Starred = {
  conversation_id: string;
  chat_title: string | null;
  id: string;
  sender_name: string | null;
  sender_avatar: string | null;
  body: string | null;
  kind: MessageKind;
  attachment: Attachment | null;
  created_at: string;
};

// Messages you starred, from every chat, newest first. Tap one to see it in its chat.
export default function StarredMessages() {
  const styles = useStyles();
  const [rows, setRows] = useState<Starred[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      supabase.rpc('starred_messages', { p_limit: 100 }).then(({ data }) => setRows((data as Starred[] | null) ?? []));
    }, []),
  );

  return (
    <Screen style={styles.screen}>
      <BackHeader title="Starred messages" />
      {rows === null ? (
        <ActivityIndicator color={brand.red} style={styles.loading} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openChat(item.conversation_id, item.id)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
              <View style={styles.head}>
                <Avatar name={item.sender_name ?? '?'} path={item.sender_avatar} size={28} />
                <Text style={styles.who} numberOfLines={1}>
                  {item.sender_name ?? 'Student'} · {item.chat_title ?? 'Chat'}
                </Text>
                <Text style={styles.time}>{listTime(item.created_at)}</Text>
              </View>
              <Text style={styles.body} numberOfLines={4}>
                {item.kind === 'text' ? item.body : previewText(item.kind, item.body, item.attachment)}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No starred messages</Text>
              <Text style={styles.emptyBody}>Long press a message and choose Star to keep it here, like exam dates or lab changes.</Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  loading: { marginTop: space.xxl },
  list: { padding: space.lg, gap: space.sm, width: '100%', maxWidth: 560, alignSelf: 'center' },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.md, gap: space.sm },
  pressed: { opacity: 0.75 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  who: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 13.5, color: t.text },
  time: { fontFamily: fonts.body, fontSize: 12, color: t.textMuted },
  body: { fontFamily: fonts.body, fontSize: 15.5, lineHeight: 22, color: t.text },
  empty: { paddingTop: space.xxl, gap: space.xs, alignItems: 'center' },
  emptyTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  emptyBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted, textAlign: 'center' },
}));
