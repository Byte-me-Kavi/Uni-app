import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { CaretLeftIcon } from 'phosphor-react-native/src/icons/CaretLeft';
import { PaperPlaneRightIcon } from 'phosphor-react-native/src/icons/PaperPlaneRight';

import { ChatIcon, subtitleFor } from '@/components/chat/chat-row';
import { MessageBubble } from '@/components/chat/message-bubble';
import { ActionSheet } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import {
  closeConversation,
  loadOlder,
  notifyTyping,
  openConversation,
  refreshChats,
  respondRequest,
  retryMessage,
  sendMessage,
} from '@/lib/chat/engine';
import { dayLabel, micros, sameDay } from '@/lib/chat/format';
import { useChat, useChatState, useMessages } from '@/lib/chat/store';
import { dismissChatNotifications } from '@/lib/push';
import type { Message } from '@/lib/chat/types';
import { supabase } from '@/lib/supabase';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Item = { type: 'message'; message: Message; showName: boolean; showAvatar: boolean } | { type: 'day'; key: string; label: string };

// One chat. Messages come from the phone's copy first, then whatever is new from the server, then
// live. Sending shows the message at once (with a clock until the server has it).
export default function ChatScreen() {
  const theme = useTheme();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const chat = useChat(id);
  const messages = useMessages(id);
  const me = useChatState((s) => s.me);
  const hasOlder = useChatState((s) => s.hasOlder[id] !== false);
  const typingUntil = useChatState((s) => s.typingUntil[id] ?? 0);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    openConversation(id);
    dismissChatNotifications(id).catch(() => {});
    return () => closeConversation();
  }, [id]);

  // Opened from a link before the chat list has it.
  useEffect(() => {
    if (!chat) refreshChats();
  }, [chat]);

  // "typing…" disappears on its own 5 seconds after the last signal.
  useEffect(() => {
    const left = typingUntil - Date.now();
    setTyping(left > 0);
    if (left <= 0) return;
    const timer = setTimeout(() => setTyping(false), left);
    return () => clearTimeout(timer);
  }, [typingUntil]);

  const group = !!chat && chat.kind !== 'direct';
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    messages.forEach((m, i) => {
      const newer = messages[i - 1];
      const older = messages[i + 1];
      out.push({
        type: 'message',
        message: m,
        showName: !older || older.sender_id !== m.sender_id || !sameDay(older.ts, m.ts),
        showAvatar: !newer || newer.sender_id !== m.sender_id || !sameDay(newer.ts, m.ts),
      });
      if (!older || !sameDay(older.ts, m.ts)) out.push({ type: 'day', key: `day-${m.ts}`, label: dayLabel(m.ts) });
    });
    return out;
  }, [messages]);

  const otherRead = micros(chat?.other_last_read_at);
  const renderItem = useCallback(
    ({ item }: { item: Item }) =>
      item.type === 'day' ? (
        <Text style={styles.day}>{item.label}</Text>
      ) : (
        <MessageBubble
          message={item.message}
          mine={item.message.sender_id === me}
          showName={item.showName}
          showAvatar={item.showAvatar}
          group={group}
          read={!group && otherRead > 0 && otherRead >= micros(item.message.created_at)}
          onRetry={retryMessage}
        />
      ),
    [me, group, otherRead, styles.day],
  );

  function send() {
    if (!draft.trim()) return;
    sendMessage(id, draft);
    setDraft('');
  }

  async function answer(accept: boolean) {
    setActionError(null);
    const error = await respondRequest(id, accept);
    if (error) setActionError(error);
    else if (!accept) router.back();
  }

  async function block() {
    if (!chat?.other_user_id) return;
    const { error } = await supabase.rpc('block_user', { p_user_id: chat.other_user_id });
    if (error) setActionError('Could not block. Try again.');
    else {
      refreshChats();
      router.back();
    }
  }

  const sentOne = messages.some((m) => m.sender_id === me);
  const firstName = chat?.title?.split(' ')[0] ?? 'They';
  const subtitle = typing
    ? 'typing…'
    : chat?.request === 'incoming'
      ? 'Wants to message you'
      : chat?.request === 'outgoing'
        ? 'Message request'
        : chat && group
          ? `${subtitleFor(chat) ?? 'Group'} · ${chat.member_count.toLocaleString()} members`
          : null;

  return (
    <Screen style={styles.screen}>
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
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <FlatList
          inverted
          data={items}
          keyExtractor={(item) => (item.type === 'day' ? item.key : item.message.id)}
          renderItem={renderItem}
          onEndReached={() => hasOlder && loadOlder(id)}
          onEndReachedThreshold={0.4}
          contentContainerStyle={styles.messages}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          maxToRenderPerBatch={20}
          windowSize={11}
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

        {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

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
        ) : (
          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={(text) => {
                setDraft(text);
                if (text) notifyTyping(id);
              }}
              placeholder="Message"
              placeholderTextColor={theme.textMuted}
              multiline
              maxLength={4000}
              style={styles.input}
              selectionColor={brand.red}
              cursorColor={brand.red}
              accessibilityLabel="Message"
            />
            <PressableScale
              onPress={send}
              disabled={!draft.trim()}
              accessibilityRole="button"
              accessibilityLabel="Send"
              style={[styles.send, !draft.trim() && styles.sendIdle]}>
              <PaperPlaneRightIcon size={20} weight="fill" color={draft.trim() ? brand.ink : theme.textMuted} />
            </PressableScale>
          </View>
        )}
      </KeyboardAvoidingView>

      <ActionSheet
        visible={confirmBlock}
        title={`Block ${chat?.title ?? 'this student'}?`}
        message="They will not be able to find you, see your profile or message you, and they will not be told."
        actions={[{ label: 'Block', destructive: true, onPress: block }]}
        onClose={() => setConfirmBlock(false)}
      />
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
  },
  back: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  iconPlaceholder: { width: 40, height: 40, borderRadius: 13, backgroundColor: t.surface },
  whoText: { flex: 1 },
  title: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  subtitle: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  typing: { fontFamily: fonts.bodyBold, color: t.text },
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
  emptyOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 72, justifyContent: 'flex-end' },
  emptyNote: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: t.textMuted,
    textAlign: 'center',
    paddingHorizontal: space.xxl,
    paddingVertical: space.xl,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderTopWidth: 1,
    borderTopColor: t.border,
    backgroundColor: t.background,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    paddingHorizontal: space.lg,
    paddingTop: 11,
    paddingBottom: 11,
    borderRadius: 22,
    backgroundColor: t.surface,
    fontFamily: fonts.body,
    fontSize: 16,
    color: t.text,
  },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: brand.red, alignItems: 'center', justifyContent: 'center' },
  sendIdle: { backgroundColor: t.surface },
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
  actionError: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.dangerText, textAlign: 'center', padding: space.sm },
}));
