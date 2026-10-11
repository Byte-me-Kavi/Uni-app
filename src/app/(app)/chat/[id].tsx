import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { CaretDownIcon } from 'phosphor-react-native/src/icons/CaretDown';
import { CaretLeftIcon } from 'phosphor-react-native/src/icons/CaretLeft';
import { DotsThreeVerticalIcon } from 'phosphor-react-native/src/icons/DotsThreeVertical';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';

import { ChatIcon, subtitleFor } from '@/components/chat/chat-row';
import { Composer } from '@/components/chat/composer';
import { EmojiPicker } from '@/components/chat/emoji-picker';
import { ForwardPicker } from '@/components/chat/forward-picker';
import { MediaViewer } from '@/components/chat/media-viewer';
import { MessageBubble } from '@/components/chat/message-bubble';
import { MessageMenu } from '@/components/chat/message-menu';
import { ReactionDetails } from '@/components/chat/reactions';
import { ReportSheet, type ReportTarget } from '@/components/chat/report-sheet';
import { StickerSheet } from '@/components/chat/sticker-sheet';
import { ReplyQuote } from '@/components/chat/reply-quote';
import { ActionSheet, type SheetAction } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import {
  closeConversation,
  deleteForEveryone,
  deleteForMe,
  fetchPresence,
  forwardMessages,
  loadOlder,
  loadUntil,
  openConversation,
  pinMessage,
  react,
  refreshChats,
  respondRequest,
  retryMessage,
  searchMessages,
  setMuted,
  starMessage,
} from '@/lib/chat/engine';
import { dayLabel, lastSeen, micros, sameDay } from '@/lib/chat/format';
import { holdStickerImport } from '@/lib/chat/sticker-library';
import { useChat, useChatState, useMessages } from '@/lib/chat/store';
import type { Message, StickerAttachment } from '@/lib/chat/types';
import { stopVoice } from '@/lib/chat/voice';
import { hasNative } from '@/lib/native';
import { dismissChatNotifications } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { useSettled } from '@/lib/use-settled';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Item =
  | { type: 'message'; message: Message; showName: boolean; showAvatar: boolean }
  | { type: 'day'; key: string; label: string }
  | { type: 'unread'; key: string; count: number };

const EDIT_MS = 15 * 60 * 1000;
const DELETE_FOR_EVERYONE_MS = 2 * 24 * 60 * 60 * 1000;

async function copyText(text: string) {
  if (Platform.OS === 'web') {
    await navigator.clipboard?.writeText(text);
    return true;
  }
  if (!hasNative('ExpoClipboard')) return false;
  await (require('expo-clipboard') as typeof import('expo-clipboard')).setStringAsync(text);
  return true;
}

// One chat. Messages come from the phone's copy first, then whatever is new from the server, then
// live. Long-press a message for reactions and actions; swipe right to reply.
export default function ChatScreen() {
  const theme = useTheme();
  const styles = useStyles();
  const { id, jump, note: startNote } = useLocalSearchParams<{ id: string; jump?: string; note?: string }>();
  const chat = useChat(id);
  const messages = useMessages(id);
  const me = useChatState((s) => s.me);
  const hasOlder = useChatState((s) => s.hasOlder[id] !== false);
  const typingUntil = useChatState((s) => s.typingUntil[id] ?? 0);
  const reactions = useChatState((s) => s.reactions);
  const starred = useChatState((s) => s.starred);
  const listRef = useRef<FlatList<Item>>(null);
  const [typing, setTyping] = useState(false);
  const [presence, setPresence] = useState<string | null>(null);
  // A note to show on arrival (e.g. who could not be added to a new group).
  const [note, setNote] = useState<string | null>(startNote ?? null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [menuFor, setMenuFor] = useState<Message | null>(null);
  const [emojiFor, setEmojiFor] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [whoReacted, setWhoReacted] = useState<{ conversationId: string; messageId: string } | null>(null);
  const [viewing, setViewing] = useState<Message | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [stickerFor, setStickerFor] = useState<StickerAttachment | null>(null);
  const [pinMenu, setPinMenu] = useState(false);
  const [chatMenu, setChatMenu] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [newWhileAway, setNewWhileAway] = useState(0);
  // Where you had read up to when the chat opened: the "unread messages" divider goes there.
  const openedAt = useRef<{ readAt: string | null; unread: number } | null>(null);
  // The first frame shows what is in memory or on the phone; server work and the hidden sheets
  // wait until the screen has slid in, so nothing is added while it moves.
  const { settled, whenSettled } = useSettled();

  useEffect(() => {
    openConversation(id, whenSettled);
    whenSettled.then(() => dismissChatNotifications(id)).catch(() => {});
    return () => {
      holdStickerImport(800); // and while going back to the list
      closeConversation();
      stopVoice();
    };
  }, [id]);

  useEffect(() => {
    if (!chat) refreshChats(); // opened from a link before the chat list has it
    else if (!openedAt.current) openedAt.current = { readAt: chat.my_last_read_at, unread: chat.unread };
  }, [chat]);

  // "typing…" disappears on its own 5 seconds after the last signal.
  useEffect(() => {
    const left = typingUntil - Date.now();
    setTyping(left > 0);
    if (left <= 0) return;
    const timer = setTimeout(() => setTyping(false), left);
    return () => clearTimeout(timer);
  }, [typingUntil]);

  // Direct chats: online, or last seen (checked every minute while open).
  const other = chat?.kind === 'direct' && !chat.request ? chat.other_user_id : null;
  useEffect(() => {
    if (!other || !settled) return;
    let live = true;
    const check = () => fetchPresence(other).then((p) => live && setPresence(lastSeen(p)));
    check();
    const timer = setInterval(check, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [other, settled]);

  // New messages while you are scrolled up: counted on the ↓ button.
  const newest = messages[0]?.id;
  const lastNewest = useRef(newest);
  useEffect(() => {
    if (newest && newest !== lastNewest.current && showJump && messages[0]?.sender_id !== me) setNewWhileAway((n) => n + 1);
    lastNewest.current = newest;
  }, [newest, showJump, messages, me]);

  const group = !!chat && chat.kind !== 'direct';
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const readAt = micros(openedAt.current?.readAt ?? null);
    const unread = openedAt.current?.unread ?? 0;
    // The oldest message from others after your read position.
    const firstUnread =
      unread > 0 ? [...messages].reverse().find((m) => m.sender_id !== me && m.status === 'sent' && micros(m.created_at) > readAt) : null;
    messages.forEach((m, i) => {
      const newer = messages[i - 1];
      const older = messages[i + 1];
      out.push({
        type: 'message',
        message: m,
        showName: !older || older.sender_id !== m.sender_id || !sameDay(older.ts, m.ts),
        showAvatar: !newer || newer.sender_id !== m.sender_id || !sameDay(newer.ts, m.ts),
      });
      if (firstUnread && m.id === firstUnread.id) out.push({ type: 'unread', key: 'unread', count: unread });
      if (!older || !sameDay(older.ts, m.ts)) out.push({ type: 'day', key: `day-${m.ts}`, label: dayLabel(m.ts) });
    });
    return out;
  }, [messages, me]);

  // With many unread, start at the divider, as WhatsApp does.
  const scrolledToUnread = useRef(false);
  useEffect(() => {
    if (scrolledToUnread.current || (openedAt.current?.unread ?? 0) < 8) return;
    const index = items.findIndex((i) => i.type === 'unread');
    if (index < 0) return;
    scrolledToUnread.current = true;
    setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.85, animated: false }), 50);
  }, [items]);

  const jumpTo = useCallback(
    async (messageId: string) => {
      setNote(null);
      const found = await loadUntil(id, messageId);
      if (!found) {
        setNote('That message is no longer in this chat.');
        return;
      }
      // Let the list render the loaded messages first.
      setTimeout(() => {
        const index = listRef.current ? currentItems.current.findIndex((i) => i.type === 'message' && i.message.id === messageId) : -1;
        if (index >= 0) listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
        setHighlight(messageId);
        setTimeout(() => setHighlight((h) => (h === messageId ? null : h)), 1600);
      }, 80);
    },
    [id],
  );
  const currentItems = useRef(items);
  currentItems.current = items;

  // Opened from Starred: go to that message once the chat has loaded.
  const jumped = useRef(false);
  useEffect(() => {
    if (!jump || jumped.current || messages.length === 0) return;
    jumped.current = true;
    jumpTo(jump);
  }, [jump, messages.length, jumpTo]);

  const showReactions = useCallback((message: Message) => setWhoReacted({ conversationId: id, messageId: message.id }), [id]);
  // Photos open the viewer; stickers open their sheet (add to favourites).
  const openMedia = useCallback(
    (m: Message) => (m.kind === 'sticker' && m.attachment ? setStickerFor(m.attachment as StickerAttachment) : setViewing(m)),
    [],
  );
  // The long-press menu opens only when it has something in it (reactions or actions).
  const openMenu = useCallback((m: Message) => {
    if (m.status === 'pending') return;
    setMenuFor(m);
  }, []);
  const otherRead = micros(chat?.other_last_read_at);
  const otherDelivered = micros(chat?.other_delivered_at);
  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      if (item.type === 'day') return <Text style={styles.day}>{item.label}</Text>;
      if (item.type === 'unread') {
        return (
          <Text style={styles.unread}>
            {item.count} unread {item.count === 1 ? 'message' : 'messages'}
          </Text>
        );
      }
      const m = item.message;
      const at = micros(m.created_at);
      return (
        <MessageBubble
          message={m}
          mine={m.sender_id === me}
          me={me}
          showName={item.showName}
          showAvatar={item.showAvatar}
          group={group}
          read={!group && otherRead > 0 && otherRead >= at}
          delivered={!group && otherDelivered > 0 && otherDelivered >= at}
          reactions={reactions[m.id]}
          starred={!!starred[m.id]}
          highlighted={highlight === m.id}
          onRetry={retryMessage}
          onOpenImage={openMedia}
          onLongPress={openMenu}
          onReply={setReplyTo}
          onJumpTo={jumpTo}
          onShowReactions={showReactions}
        />
      );
    },
    [me, group, otherRead, otherDelivered, reactions, starred, highlight, jumpTo, showReactions, styles.day, styles.unread],
  );

  // Search in this chat (the phone's copy: instant, and works offline).
  useEffect(() => {
    if (!searching || query.trim().length < 2) {
      setResults([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => searchMessages(id, query).then((found) => live && setResults(found)), 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [searching, query, id]);

  async function answer(accept: boolean) {
    setNote(null);
    const error = await respondRequest(id, accept);
    if (error) setNote(error);
    else if (!accept) router.back();
  }

  async function block() {
    if (!chat?.other_user_id) return;
    const { error } = await supabase.rpc('block_user', { p_user_id: chat.other_user_id });
    if (error) setNote('Could not block. Try again.');
    else {
      refreshChats();
      router.back();
    }
  }

  const report = (error: string | null) => error && setNote(error);

  // The long-press menu, in WhatsApp's order.
  function actionsFor(m: Message): SheetAction[] {
    const mine = m.sender_id === me;
    const sent = m.status === 'sent' && !m.deleted;
    const age = Date.now() - m.ts;
    const actions: SheetAction[] = [];
    if (sent) actions.push({ label: 'Reply', onPress: () => setReplyTo(m) });
    if (m.body && !m.deleted) {
      actions.push({
        label: 'Copy',
        onPress: () => copyText(m.body ?? '').then((ok) => setNote(ok ? 'Copied' : 'Update Uni Era to copy messages.')),
      });
    }
    if (sent) actions.push({ label: 'Forward', onPress: () => setForwarding(m) });
    if (sent) {
      actions.push(
        starred[m.id]
          ? { label: 'Unstar', onPress: () => starMessage(id, m, false).then(report) }
          : { label: 'Star', onPress: () => starMessage(id, m, true).then(report) },
      );
      // In groups only reps and group admins pin (the server enforces the same).
      if (!group || chat?.my_role === 'admin') {
        actions.push(
          chat?.pinned?.id === m.id
            ? { label: 'Unpin', onPress: () => pinMessage(id, null).then(report) }
            : { label: 'Pin', onPress: () => pinMessage(id, m).then(report) },
        );
      }
    }
    if (sent && mine && ['text', 'image', 'file'].includes(m.kind) && age < EDIT_MS && (m.kind === 'text' || m.body)) {
      actions.push({ label: 'Edit', onPress: () => setEditing(m) });
    }
    if (sent && !mine) {
      actions.push({
        label: 'Report',
        destructive: true,
        onPress: () => setReporting({ kind: 'message', id: m.id, conversationId: id, who: m.sender_name, userId: m.sender_id }),
      });
    }
    if (!m.deleted) actions.push({ label: 'Delete', destructive: true, onPress: () => setDeleting(m) });
    // A deleted message's placeholder can be cleared from your own view, as in WhatsApp.
    else actions.push({ label: 'Delete for me', destructive: true, onPress: () => deleteForMe(id, [m]).then(report) });
    return actions;
  }

  const deleteActions: SheetAction[] = deleting
    ? [
        ...(deleting.sender_id === me && deleting.status === 'sent' && Date.now() - deleting.ts < DELETE_FOR_EVERYONE_MS
          ? [{ label: 'Delete for everyone', destructive: true, onPress: () => deleteForEveryone(id, deleting).then(report) }]
          : []),
        { label: 'Delete for me', destructive: true, onPress: () => deleteForMe(id, [deleting]).then(report) },
      ]
    : [];

  const firstName = chat?.title?.split(' ')[0] ?? 'They';
  const chatActions: SheetAction[] = [
    { label: 'Search', onPress: () => setSearching(true) },
    { label: 'Photos, documents and voice notes', onPress: () => router.push({ pathname: '/chat-files/[id]', params: { id } }) },
    chat?.muted
      ? { label: 'Unmute notifications', onPress: () => setMuted(id, false).then(report) }
      : { label: 'Mute notifications', onPress: () => setMuted(id, true).then(report) },
    group
      ? { label: 'Group details', onPress: () => router.push({ pathname: '/group/[id]', params: { id } }) }
      : { label: 'View profile', onPress: () => chat?.other_user_id && router.push({ pathname: '/people/[id]', params: { id: chat.other_user_id } }) },
    group
      ? { label: 'Report group', destructive: true, onPress: () => setReporting({ kind: 'conversation', id, who: chat?.title ?? null }) }
      : {
          label: `Report ${firstName}`,
          destructive: true,
          onPress: () => chat?.other_user_id && setReporting({ kind: 'profile', id: chat.other_user_id, who: chat.title }),
        },
  ];

  const sentOne = messages.some((m) => m.sender_id === me);
  const subtitle = typing
    ? 'typing…'
    : chat?.request === 'incoming'
      ? 'Wants to message you'
      : chat?.request === 'outgoing'
        ? 'Message request'
        : chat && group
          ? `${subtitleFor(chat) ?? 'Group'} · ${chat.member_count.toLocaleString()} members`
          : presence;
  const myReaction = menuFor ? (reactions[menuFor.id]?.find((r) => r.mine)?.emoji ?? null) : null;

  return (
    <Screen style={styles.screen}>
      {searching ? (
        <View style={styles.header}>
          <PressableScale
            onPress={() => {
              setSearching(false);
              setQuery('');
            }}
            accessibilityRole="button"
            accessibilityLabel="Close search"
            hitSlop={12}
            style={styles.back}>
            <CaretLeftIcon size={22} weight="bold" color={theme.text} />
          </PressableScale>
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoFocus
            placeholder="Search this chat"
            placeholderTextColor={theme.textMuted}
            style={styles.searchInput}
            selectionColor={brand.accent}
            accessibilityLabel="Search this chat"
          />
        </View>
      ) : (
        <View style={styles.header}>
          <PressableScale onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} style={styles.back}>
            <CaretLeftIcon size={22} weight="bold" color={theme.text} />
          </PressableScale>
          <Pressable
            style={styles.who}
            disabled={!chat}
            onPress={() => {
              if (chat?.other_user_id) router.push({ pathname: '/people/[id]', params: { id: chat.other_user_id } });
              else if (chat) router.push({ pathname: '/group/[id]', params: { id: chat.conversation_id } });
            }}
            accessibilityRole={chat ? 'button' : undefined}
            accessibilityLabel={chat ? `${chat.title}. ${group ? 'Group details' : 'Profile'}` : 'Chat'}>
            {chat ? <ChatIcon chat={chat} size={40} /> : <View style={styles.iconPlaceholder} />}
            <View style={styles.whoText}>
              <Text style={styles.title} numberOfLines={1}>
                {chat?.title ?? ' '}
              </Text>
              {subtitle ? (
                <Text style={[styles.subtitle, typing && styles.typing]} numberOfLines={1} accessibilityLiveRegion="polite">
                  {subtitle}
                </Text>
              ) : null}
            </View>
          </Pressable>
          <PressableScale onPress={() => setSearching(true)} accessibilityRole="button" accessibilityLabel="Search this chat" hitSlop={8} style={styles.headerButton}>
            <MagnifyingGlassIcon size={21} weight="bold" color={theme.text} />
          </PressableScale>
          <PressableScale onPress={() => setChatMenu(true)} accessibilityRole="button" accessibilityLabel="More" hitSlop={8} style={styles.headerButton}>
            <DotsThreeVerticalIcon size={22} weight="bold" color={theme.text} />
          </PressableScale>
        </View>
      )}

      {chat?.pinned && !searching ? (
        <View style={styles.pinned}>
          <ReplyQuote reply={chat.pinned} me={me} label="Pinned message" onPress={() => setPinMenu(true)} />
        </View>
      ) : null}

      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <View style={styles.flex}>
          <FlatList
            ref={listRef}
            inverted
            data={items}
            keyExtractor={(item) => (item.type === 'message' ? item.message.id : item.key)}
            renderItem={renderItem}
            onEndReached={() => hasOlder && loadOlder(id)}
            onEndReachedThreshold={0.4}
            contentContainerStyle={styles.messages}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            // While the screen slides in, only what fits on screen is drawn; messages above it
            // follow once the slide has finished, so nothing extra is built mid-animation.
            initialNumToRender={12}
            maxToRenderPerBatch={8}
            windowSize={settled ? 7 : 1}
            onScroll={(e) => {
              const away = e.nativeEvent.contentOffset.y > 400;
              if (away !== showJump) setShowJump(away);
              if (!away) setNewWhileAway(0);
            }}
            scrollEventThrottle={100}
            onScrollToIndexFailed={({ averageItemLength, index }) => {
              listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
              setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true }), 120);
            }}
          />

          {/* Outside the list on purpose: inverted lists flip their content differently on each
              platform (vertically on web, both ways on Android), so a note inside would be mirrored. */}
          {items.length === 0 ? (
            <View style={styles.emptyOverlay} pointerEvents="none">
              <Text style={styles.emptyNote}>
                {chat?.kind === 'direct'
                  ? chat.request === 'outgoing'
                    ? `${firstName} is at another university, so your first message goes to their requests.`
                    : `Say hello to ${firstName}.`
                  : 'No messages yet. Start the conversation.'}
              </Text>
            </View>
          ) : null}

          {showJump ? (
            <PressableScale
              onPress={() => {
                listRef.current?.scrollToOffset({ offset: 0, animated: true });
                setNewWhileAway(0);
              }}
              accessibilityRole="button"
              accessibilityLabel={newWhileAway ? `${newWhileAway} new messages. Scroll to the latest` : 'Scroll to the latest'}
              style={styles.jump}>
              <CaretDownIcon size={20} weight="bold" color={theme.text} />
              {newWhileAway ? (
                <View style={styles.jumpBadge}>
                  <Text style={styles.jumpBadgeText}>{newWhileAway > 99 ? '99+' : newWhileAway}</Text>
                </View>
              ) : null}
            </PressableScale>
          ) : null}

          {searching && query.trim().length >= 2 ? (
            <View style={styles.results}>
              <FlatList
                data={results}
                keyExtractor={(m) => m.id}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => {
                      setSearching(false);
                      setQuery('');
                      jumpTo(item.id);
                    }}
                    accessibilityRole="button"
                    style={styles.result}>
                    <Text style={styles.resultWho} numberOfLines={1}>
                      {item.sender_id === me ? 'You' : (item.sender_name ?? 'Student')} · {dayLabel(item.ts)}
                    </Text>
                    <Text style={styles.resultText} numberOfLines={2}>
                      {item.body}
                    </Text>
                  </Pressable>
                )}
                ListEmptyComponent={<Text style={styles.resultEmpty}>No messages with those words on this phone.</Text>}
              />
            </View>
          ) : null}
        </View>

        {note ? (
          <Pressable onPress={() => setNote(null)} accessibilityLiveRegion="polite">
            <Text style={styles.note}>{note}</Text>
          </Pressable>
        ) : null}

        {chat?.request === 'incoming' ? (
          <View style={styles.requestBar}>
            <Text style={styles.requestText}>
              {firstName} is at another university and wants to message you. They will not know you have seen this unless you reply or accept.
            </Text>
            <View style={styles.requestActions}>
              <View style={styles.flex}>
                <Button label="Accept" onPress={() => answer(true)} />
              </View>
              <View style={styles.flex}>
                <Button label="Ignore" variant="quiet" onPress={() => answer(false)} />
              </View>
            </View>
            <Pressable onPress={() => setConfirmBlock(true)} accessibilityRole="button" style={styles.blockLink}>
              <Text style={styles.blockText}>Block {firstName}</Text>
            </Pressable>
          </View>
        ) : chat?.request === 'outgoing' && sentOne ? (
          <Text style={styles.waiting}>Request sent. You can send more once {firstName} accepts.</Text>
        ) : group && chat?.announcement_only && chat.my_role !== 'admin' ? (
          <Text style={styles.waiting} accessibilityLiveRegion="polite">
            {chat.kind === 'group' ? 'Only admins can send messages here.' : 'Only batch reps can send messages here.'}
          </Text>
        ) : (
          <Composer
            chat={chat}
            conversationId={id}
            me={me}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            editing={editing}
            onCancelEdit={() => setEditing(null)}
            onError={setNote}
          />
        )}
      </KeyboardAvoidingView>

      {settled ? (
        <>
          <MessageMenu
            visible={!!menuFor}
            mine={myReaction}
            canReact={!!menuFor && menuFor.status === 'sent' && !menuFor.deleted}
            actions={menuFor ? actionsFor(menuFor) : []}
            onReact={(emoji) => menuFor && react(id, menuFor.id, emoji).then(report)}
            onMoreEmoji={() => setEmojiFor(menuFor)}
            onClose={() => setMenuFor(null)}
          />
          <EmojiPicker
            visible={!!emojiFor}
            onClose={() => setEmojiFor(null)}
            onPick={(emoji) => {
              if (emojiFor) react(id, emojiFor.id, emoji).then(report);
              setEmojiFor(null);
            }}
          />
          <ActionSheet
            visible={!!deleting}
            title="Delete message?"
            actions={deleteActions}
            onClose={() => setDeleting(null)}
          />
          <ForwardPicker
            visible={!!forwarding}
            onClose={() => setForwarding(null)}
            onSend={(ids) => {
              if (forwarding) forwardMessages([forwarding], ids);
              setForwarding(null);
              setNote(ids.length === 1 ? 'Forwarded' : `Forwarded to ${ids.length} chats`);
            }}
          />
          <ReactionDetails target={whoReacted} me={me} onClose={() => setWhoReacted(null)} />
          <ReportSheet target={reporting} onClose={() => setReporting(null)} />
          <StickerSheet sticker={stickerFor} onClose={() => setStickerFor(null)} />
          <ActionSheet
            visible={pinMenu}
            title="Pinned message"
            actions={[
              { label: 'Go to message', onPress: () => chat?.pinned && jumpTo(chat.pinned.id) },
              // In groups only reps and admins can unpin (as they pin); in direct chats either of you.
              ...(!group || chat?.my_role === 'admin'
                ? [{ label: 'Unpin', destructive: true, onPress: () => pinMessage(id, null).then(report) }]
                : []),
            ]}
            onClose={() => setPinMenu(false)}
          />
          <MediaViewer message={viewing} onClose={() => setViewing(null)} />
          <ActionSheet visible={chatMenu} actions={chatActions} onClose={() => setChatMenu(false)} />
          <ActionSheet
            visible={confirmBlock}
            title={`Block ${chat?.title ?? 'this student'}?`}
            message="They will not be able to find you, see your profile or message you, and they will not be told."
            actions={[{ label: 'Block', destructive: true, onPress: block }]}
            onClose={() => setConfirmBlock(false)}
          />
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
    minHeight: 61,
  },
  back: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  iconPlaceholder: { width: 40, height: 40, borderRadius: 13, backgroundColor: t.surface },
  whoText: { flex: 1 },
  title: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  subtitle: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  typing: { fontFamily: fonts.bodyBold, color: t.text },
  headerButton: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchInput: {
    flex: 1,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: t.surface,
    paddingHorizontal: space.lg,
    fontFamily: fonts.body,
    fontSize: 16,
    color: t.text,
    marginRight: space.sm,
  },
  pinned: { paddingHorizontal: space.md, paddingTop: space.sm, borderBottomWidth: 1, borderBottomColor: t.border, paddingBottom: space.xs },
  messages: { paddingVertical: space.md },
  day: {
    alignSelf: 'center',
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: t.textMuted,
    backgroundColor: t.surface,
    paddingHorizontal: space.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginVertical: space.md,
  },
  unread: {
    alignSelf: 'stretch',
    textAlign: 'center',
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: t.text,
    backgroundColor: t.surface,
    paddingVertical: space.xs + 2,
    marginVertical: space.sm,
  },
  emptyOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end' },
  emptyNote: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: t.textMuted,
    textAlign: 'center',
    paddingHorizontal: space.xxl,
    paddingVertical: space.xl,
  },
  jump: {
    position: 'absolute',
    right: space.md,
    bottom: space.md,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: t.elevated,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The accent marks something for you to do; what sits on it is Ink.
  jumpBadge: {
    position: 'absolute',
    top: -6,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: brand.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jumpBadgeText: { fontFamily: fonts.bodyBold, fontSize: 11, color: brand.ink },
  results: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: t.background },
  result: { paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: t.border },
  resultWho: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.textMuted },
  resultText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.text },
  resultEmpty: { fontFamily: fonts.body, fontSize: 15, color: t.textMuted, textAlign: 'center', padding: space.xl },
  note: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted, textAlign: 'center', padding: space.sm },
  requestBar: { padding: space.lg, gap: space.md, borderTopWidth: 1, borderTopColor: t.border },
  requestText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.textMuted, textAlign: 'center' },
  requestActions: { flexDirection: 'row', gap: space.sm },
  blockLink: { alignSelf: 'center', padding: space.sm },
  blockText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.dangerText },
  waiting: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    lineHeight: 20,
    color: t.textMuted,
    textAlign: 'center',
    padding: space.lg,
    borderTopWidth: 1,
    borderTopColor: t.border,
  },
}));
