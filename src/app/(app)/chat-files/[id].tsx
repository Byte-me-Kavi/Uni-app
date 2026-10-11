import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View, useWindowDimensions } from 'react-native';

import { FileMessage } from '@/components/chat/file-message';
import { MediaViewer } from '@/components/chat/media-viewer';
import { BackHeader } from '@/components/ui/back-header';
import { PressableScale } from '@/components/ui/pressable-scale';
import { listTime } from '@/lib/chat/format';
import { useSignedUrl } from '@/lib/chat/media-urls';
import { useChat } from '@/lib/chat/store';
import type { Attachment, FileAttachment, ImageAttachment, Message, MessageKind, VoiceAttachment } from '@/lib/chat/types';
import { voiceAvailable } from '@/lib/chat/voice';
import { Screen } from '@/components/ui/screen';
import { supabase } from '@/lib/supabase';
import { brand, createThemedStyles, fonts, radius, space } from '@/theme/tokens';

type Tab = 'media' | 'docs' | 'voice';
type Row = { id: string; kind: MessageKind; body: string | null; attachment: Attachment; sender_name: string | null; created_at: string };

const VoiceMessage = voiceAvailable() ? require('@/components/chat/voice-message').VoiceMessage : null;
const TABS: { key: Tab; label: string }[] = [
  { key: 'media', label: 'Photos' },
  { key: 'docs', label: 'Documents' },
  { key: 'voice', label: 'Voice notes' },
];

const asMessage = (conversationId: string, r: Row): Message => ({
  id: r.id,
  conversation_id: conversationId,
  sender_id: null,
  sender_name: r.sender_name,
  sender_avatar: null,
  body: r.body,
  reply_to_id: null,
  created_at: r.created_at,
  ts: Date.parse(r.created_at),
  status: 'sent',
  error: null,
  deleted: false,
  kind: r.kind,
  attachment: r.attachment,
});

// Everything shared in a chat, newest first: photos as a grid, documents and voice notes as lists.
// For a batch group this is where lecture notes and past papers collect, and the base for its
// module resources.
export default function ChatFiles() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const chat = useChat(id);
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>('media');
  const [rows, setRows] = useState<Row[]>([]);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<Message | null>(null);
  const busy = useRef(false);

  const load = useCallback(
    async (kind: Tab, before: string | null) => {
      if (busy.current) return;
      busy.current = true;
      setLoading(true);
      const { data, error } = await supabase.rpc('chat_files', {
        p_conversation_id: id,
        p_kind: kind,
        p_limit: 60,
        ...(before ? { p_before: before } : {}),
      });
      busy.current = false;
      setLoading(false);
      if (error) return;
      const page = (data ?? []) as Row[];
      setRows((current) => (before ? [...current, ...page] : page));
      setMore(page.length === 60);
    },
    [id],
  );

  useEffect(() => {
    setRows([]);
    setMore(true);
    load(tab, null);
  }, [tab, load]);

  const columns = 3;
  const cell = Math.floor((Math.min(width, 560) - space.md * 2 - space.xs * (columns - 1)) / columns);

  return (
    <Screen style={styles.screen}>
      <BackHeader title={chat?.title ?? 'Shared files'} />
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((t) => (
          <PressableScale
            key={t.key}
            onPress={() => setTab(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
            style={[styles.tab, tab === t.key && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </PressableScale>
        ))}
      </View>

      <FlatList
        key={tab}
        data={rows}
        numColumns={tab === 'media' ? columns : 1}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        columnWrapperStyle={tab === 'media' ? styles.gridRow : undefined}
        onEndReached={() => more && rows.length > 0 && load(tab, rows[rows.length - 1].created_at)}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) =>
          tab === 'media' ? (
            <Thumb row={item} size={cell} onPress={() => setViewing(asMessage(id, item))} />
          ) : (
            <View style={styles.rowCard}>
              {tab === 'docs' ? (
                <FileMessage message={asMessage(id, item)} file={item.attachment as FileAttachment} />
              ) : VoiceMessage ? (
                <VoiceMessage message={asMessage(id, item)} voice={item.attachment as VoiceAttachment} mine={false} />
              ) : (
                <Text style={styles.detail}>Update Uni Era to play voice notes.</Text>
              )}
              <Text style={styles.detail}>
                {item.sender_name ?? 'Student'} · {listTime(item.created_at)}
              </Text>
            </View>
          )
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={brand.red} style={styles.loading} />
          ) : (
            <Text style={styles.empty}>
              {tab === 'media' ? 'No photos yet.' : tab === 'docs' ? 'No documents yet.' : 'No voice notes yet.'}
            </Text>
          )
        }
      />
      <MediaViewer message={viewing} onClose={() => setViewing(null)} />
    </Screen>
  );
}

function Thumb({ row, size, onPress }: { row: Row; size: number; onPress: () => void }) {
  const styles = useStyles();
  const image = row.attachment as ImageAttachment;
  const url = useSignedUrl(image.path);
  return (
    <Pressable onPress={onPress} accessibilityRole="imagebutton" accessibilityLabel={row.body ? `Photo: ${row.body}` : 'Photo'}>
      <Image
        source={url ? { uri: url, cacheKey: image.path } : null}
        placeholder={image.thumb ? { uri: image.thumb } : null}
        style={[styles.thumb, { width: size, height: size }]}
        contentFit="cover"
        cachePolicy="memory-disk"
      />
    </Pressable>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  tabs: { flexDirection: 'row', paddingHorizontal: space.md, gap: space.sm, paddingBottom: space.sm },
  tab: { paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: t.surface },
  tabActive: { backgroundColor: t.focus },
  tabText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  tabTextActive: { color: t.background },
  list: { padding: space.md, paddingBottom: space.xxxl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  gridRow: { gap: space.xs, marginBottom: space.xs },
  thumb: { borderRadius: radius.sm, backgroundColor: t.surface },
  rowCard: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.md, marginBottom: space.sm, gap: space.xs },
  detail: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  loading: { marginTop: space.xxl },
  empty: { fontFamily: fonts.body, fontSize: 15, color: t.textMuted, textAlign: 'center', padding: space.xl },
}));
