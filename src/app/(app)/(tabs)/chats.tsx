import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { UsersThreeIcon } from 'phosphor-react-native/src/icons/UsersThree';
import { XIcon } from 'phosphor-react-native/src/icons/X';

import { ChatRow } from '@/components/chat/chat-row';
import { NotifyCard } from '@/components/chat/notify-card';
import { ActionSheet, type SheetAction } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { prefetchConversation, refreshChats, searchAllMessages, setChatListState, setMuted } from '@/lib/chat/engine';
import { listTime } from '@/lib/chat/format';
import { openChat } from '@/lib/chat/open-chat';
import { useChatState } from '@/lib/chat/store';
import type { Chat, Message } from '@/lib/chat/types';
import { useHomeData } from '@/providers/home-provider';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Section = 'chats' | 'requests' | 'archived';
type Row = { type: 'chat'; chat: Chat } | { type: 'message'; message: Message; title: string } | { type: 'label'; text: string };

// The Chats tab: your batch group, your national programme group, your own groups and direct
// messages, newest first (the ones you pinned on top), drawn from the phone's copy at once and
// refreshed from the server when the tab opens. Message requests from other universities wait
// under Requests; chats you archived, under Archived. Long press a chat to pin, archive or mute it.
// Search finds chats by name and messages already on this phone.
export default function Chats() {
  const theme = useTheme();
  const styles = useStyles();
  const chats = useChatState((s) => s.chats);
  const loaded = useChatState((s) => s.chatsLoaded);
  const me = useChatState((s) => s.me);
  const { state: home } = useHomeData();
  const [section, setSection] = useState<Section>('chats');
  const [refreshing, setRefreshing] = useState(false);
  const [menuFor, setMenuFor] = useState<Chat | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Message[]>([]);

  // Refreshed when the tab shows, just after any slide back from a chat has finished.
  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(refreshChats, 400);
      return () => clearTimeout(timer);
    }, []),
  );

  // Message search: on this phone, every word, after typing pauses.
  const searching = query.trim().length > 0;
  useEffect(() => {
    if (query.trim().length < 2) {
      setFound([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => searchAllMessages(query).then((rows) => live && setFound(rows)), 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const requests = chats.filter((c) => c.request === 'incoming');
  const archived = chats.filter((c) => c.archived && c.request !== 'incoming');
  const main = chats.filter((c) => c.request !== 'incoming' && !c.archived);
  const visible = section === 'requests' ? requests : section === 'archived' ? archived : main;
  const hasBatch = home.status === 'ready' ? home.home.has_cohort : true;
  // Back to Chats once a section empties (the last request answered, the last chat unarchived).
  useEffect(() => {
    if ((section === 'requests' && !requests.length) || (section === 'archived' && !archived.length)) setSection('chats');
  }, [section, requests.length, archived.length]);

  const titleOf = (conversationId: string) => chats.find((c) => c.conversation_id === conversationId)?.title ?? 'Chat';
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows: Row[] = searching
    ? [
        ...chats
          .filter((c) => words.every((w) => (c.title ?? '').toLowerCase().includes(w)))
          .map((chat) => ({ type: 'chat' as const, chat })),
        ...(found.length ? [{ type: 'label' as const, text: 'Messages' }] : []),
        ...found.map((message) => ({ type: 'message' as const, message, title: titleOf(message.conversation_id) })),
      ]
    : visible.map((chat) => ({ type: 'chat' as const, chat }));

  async function refresh() {
    setRefreshing(true);
    await refreshChats();
    setRefreshing(false);
  }

  const open = useCallback((chat: Chat) => openChat(chat.conversation_id), []);
  // Touch down starts loading the chat's messages from the phone, so they are in memory by the
  // time the screen draws.
  const warm = useCallback((chat: Chat) => prefetchConversation(chat.conversation_id), []);
  const menu = useCallback((chat: Chat) => setMenuFor(chat), []);

  const done = (error: string | null) => setNote(error);
  function actionsFor(chat: Chat): SheetAction[] {
    const actions: SheetAction[] = [];
    if (!chat.archived && !chat.request) {
      actions.push(
        chat.list_pinned_at
          ? { label: 'Unpin chat', onPress: () => setChatListState(chat.conversation_id, { pinned: false }).then(done) }
          : { label: 'Pin to top', onPress: () => setChatListState(chat.conversation_id, { pinned: true }).then(done) },
      );
    }
    actions.push(
      chat.archived
        ? { label: 'Unarchive', onPress: () => setChatListState(chat.conversation_id, { archived: false }).then(done) }
        : { label: 'Archive', onPress: () => setChatListState(chat.conversation_id, { archived: true }).then(done) },
    );
    actions.push(
      chat.muted
        ? { label: 'Unmute', onPress: () => setMuted(chat.conversation_id, false).then(done) }
        : { label: 'Mute', onPress: () => setMuted(chat.conversation_id, true).then(done) },
    );
    return actions;
  }

  const segments: Section[] = ['chats', ...(requests.length ? (['requests'] as const) : []), ...(archived.length ? (['archived'] as const) : [])];
  const segmentLabel = (key: Section) =>
    key === 'chats' ? 'Chats' : key === 'requests' ? `Requests (${requests.length})` : `Archived (${archived.length})`;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.heading} accessibilityRole="header">
            Chats
          </Text>
          <PressableScale
            onPress={() => router.push('/new-group')}
            accessibilityRole="button"
            accessibilityLabel="New group"
            style={styles.newGroup}>
            <PlusIcon size={16} color={theme.onAccent} weight="bold" />
            <Text style={styles.newGroupText}>New group</Text>
          </PressableScale>
        </View>
        <View style={styles.search}>
          <MagnifyingGlassIcon size={18} color={theme.textMuted} weight="bold" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search chats and messages"
            placeholderTextColor={theme.textMuted}
            autoCorrect={false}
            returnKeyType="search"
            style={styles.searchInput}
            selectionColor={theme.accent}
            cursorColor={theme.accent}
            accessibilityLabel="Search chats and messages"
          />
          {searching ? (
            <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10}>
              <XIcon size={18} color={theme.textMuted} weight="bold" />
            </Pressable>
          ) : null}
        </View>
        {!searching && segments.length > 1 ? (
          <View style={styles.segments} accessibilityRole="tablist">
            {segments.map((key) => (
              <PressableScale
                key={key}
                onPress={() => setSection(key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: section === key }}
                style={[styles.segment, section === key && styles.segmentActive]}>
                <Text style={[styles.segmentText, section === key && styles.segmentTextActive]}>{segmentLabel(key)}</Text>
              </PressableScale>
            ))}
          </View>
        ) : null}
        {note ? (
          <Text style={styles.note} accessibilityLiveRegion="polite" onPress={() => setNote(null)}>
            {note}
          </Text>
        ) : null}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r, i) => (r.type === 'chat' ? r.chat.conversation_id : r.type === 'message' ? r.message.id : `label-${i}`)}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) =>
          item.type === 'chat' ? (
            <ChatRow chat={item.chat} me={me} onOpen={open} onWarm={warm} onMenu={menu} />
          ) : item.type === 'label' ? (
            <Text style={styles.label}>{item.text}</Text>
          ) : (
            <Pressable
              onPress={() => openChat(item.message.conversation_id, item.message.id)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.result, pressed && styles.pressed]}>
              <View style={styles.resultTop}>
                <Text style={styles.resultTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.resultTime}>{listTime(item.message.created_at)}</Text>
              </View>
              <Text style={styles.resultBody} numberOfLines={2}>
                {item.message.sender_id === me ? 'You: ' : item.message.sender_name ? `${item.message.sender_name.split(' ')[0]}: ` : ''}
                {item.message.body}
              </Text>
            </Pressable>
          )
        }
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accentText} colors={[theme.accentText]} />
        }
        ListHeaderComponent={
          searching ? null : section === 'chats' && hasBatch ? (
            <NotifyCard />
          ) : !hasBatch && section === 'chats' ? (
            <View style={styles.joinCard}>
              <View style={styles.joinIcon}>
                <UsersThreeIcon size={24} weight="bold" color={theme.onAccent} />
              </View>
              <Text style={styles.joinTitle}>Join your batch</Text>
              <Text style={styles.joinBody}>
                You get your batch group and a national group for your degree, with students from every university.
              </Text>
              <Button label="Find my batch" onPress={() => router.push('/batch')} />
            </View>
          ) : section === 'archived' ? (
            <Text style={styles.archivedNote}>Archived chats stay here when new messages arrive. Long press one to unarchive it.</Text>
          ) : null
        }
        ListEmptyComponent={
          searching ? (
            <Text style={styles.emptyBody}>
              {query.trim().length < 2 ? 'Keep typing to search messages too.' : 'No chats or messages on this phone match.'}
            </Text>
          ) : !loaded ? (
            <View accessible accessibilityLabel="Loading chats">
              {[0, 1, 2].map((i) => (
                <View key={i} style={styles.skeletonRow}>
                  <View style={styles.skeletonIcon} />
                  <View style={styles.skeletonText}>
                    <View style={[styles.skeletonLine, { width: '55%' }]} />
                    <View style={[styles.skeletonLine, { width: '80%', height: 12 }]} />
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{section === 'requests' ? 'No requests' : 'No chats yet'}</Text>
              <Text style={styles.emptyBody}>
                {section === 'requests'
                  ? 'Messages from students at other universities wait here until you accept them.'
                  : 'Search for a student at the top and open their profile to message them, or make a group.'}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          !searching && section === 'chats' && visible.length > 0 ? (
            <Text style={[styles.footer, { color: theme.textMuted }]}>
              Long press a chat to pin, archive or mute it.
            </Text>
          ) : null
        }
      />

      <ActionSheet
        visible={!!menuFor}
        actions={menuFor ? actionsFor(menuFor) : []}
        onClose={() => setMenuFor(null)}
      />
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { flex: 1 },
  header: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.sm, gap: space.md, width: '100%', maxWidth: 560, alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: t.text, letterSpacing: -0.3 },
  newGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    // The accent marks the thing to do; what sits on it is Ink.
    backgroundColor: t.accent,
  },
  newGroupText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.onAccent },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 42,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: t.surface,
  },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: t.text, paddingVertical: 0 },
  segments: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  segment: { paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: t.surface },
  segmentActive: { backgroundColor: t.focus },
  segmentText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  segmentTextActive: { color: t.background },
  note: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.dangerText },
  list: { paddingHorizontal: space.xl - space.sm, paddingBottom: space.xxxl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  label: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.textMuted, paddingHorizontal: space.sm, paddingTop: space.lg, paddingBottom: space.xs },
  result: { paddingHorizontal: space.sm, paddingVertical: space.sm + 2, borderRadius: radius.md, gap: 2 },
  pressed: { backgroundColor: t.surface },
  resultTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  resultTitle: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  resultTime: { fontFamily: fonts.body, fontSize: 12.5, color: t.textMuted },
  resultBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
  archivedNote: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: t.textMuted, paddingHorizontal: space.sm, paddingBottom: space.sm },
  joinCard: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm, margin: space.sm, marginBottom: space.md },
  joinIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  joinTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  joinBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted, marginBottom: space.xs },
  empty: { paddingHorizontal: space.sm, paddingTop: space.xl, gap: space.xs },
  emptyTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  emptyBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted, paddingHorizontal: space.sm },
  footer: { fontFamily: fonts.body, fontSize: 13, textAlign: 'center', paddingTop: space.xl },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm },
  skeletonIcon: { width: 52, height: 52, borderRadius: 17, backgroundColor: t.surface },
  skeletonText: { flex: 1, gap: space.sm },
  skeletonLine: { height: 14, borderRadius: radius.sm, backgroundColor: t.surface },
}));
