import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { BellIcon } from 'phosphor-react-native/src/icons/Bell';
import { BellSlashIcon } from 'phosphor-react-native/src/icons/BellSlash';

import { ChatIcon, subtitleFor } from '@/components/chat/chat-row';
import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';
import { ActionSheet } from '@/components/ui/action-sheet';
import { Avatar } from '@/components/ui/avatar';
import { BackHeader } from '@/components/ui/back-header';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { readCache, writeCache } from '@/lib/cache';
import { setMuted } from '@/lib/chat/engine';
import { useChat, useChatState } from '@/lib/chat/store';
import { supabase } from '@/lib/supabase';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Member = { user_id: string; full_name: string; avatar_path: string | null; institution: string; is_admin: boolean };

const PAGE = 50;

// A group's details: what it is, muting, and its students by name. The first page of members
// comes from the phone (last visit) and refreshes behind it; the rest load as you scroll, so a
// national group of thousands opens as fast as a batch of forty.
export default function GroupDetails() {
  const theme = useTheme();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const chat = useChat(id);
  const me = useChatState((s) => s.me);
  const cacheKey = me ? `${me}:members:${id}` : null;
  const [members, setMembers] = useState<Member[]>(() => (cacheKey ? (readCache<Member[]>(cacheKey) ?? []) : []));
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [muteSheet, setMuteSheet] = useState(false);
  const [muteError, setMuteError] = useState<string | null>(null);
  const busy = useRef(false);

  const load = useCallback(
    async (after: Member | null) => {
      if (busy.current) return;
      busy.current = true;
      setLoading(true);
      const { data, error } = await supabase.rpc('chat_members', {
        p_conversation_id: id,
        p_limit: PAGE,
        ...(after ? { p_after_name: after.full_name, p_after_id: after.user_id } : {}),
      });
      busy.current = false;
      setLoading(false);
      if (error) {
        setFailed(true);
        return;
      }
      setFailed(false);
      const page = (data ?? []) as Member[];
      setMembers((current) => (after ? [...current, ...page] : page));
      setMore(page.length === PAGE);
      if (!after && cacheKey) writeCache(cacheKey, page);
    },
    [id, cacheKey],
  );

  useEffect(() => {
    load(null);
  }, [load]);

  async function mute(on: boolean, hours: number | null = null) {
    setMuteError(null);
    const error = await setMuted(id, on, hours);
    if (error) setMuteError('Could not change this. Check your connection and try again.');
  }

  const programme = chat?.kind === 'programme';
  const header = (
    <View style={styles.headerStack}>
      <View style={styles.identity}>
        {chat ? <ChatIcon chat={chat} size={88} /> : <View style={styles.iconPlaceholder} />}
        <Text style={styles.title} accessibilityRole="header">
          {chat?.title ?? ' '}
        </Text>
        <Text style={styles.subtitle}>
          {chat ? `${subtitleFor(chat) ?? 'Group'} · ${chat.member_count.toLocaleString()} members` : ' '}
        </Text>
      </View>

      <SettingsGroup
        title="Notifications"
        footer={
          chat?.muted
            ? 'You still get messages here; your phone just stays quiet.'
            : 'Groups notify you once, then again after you read them or 15 minutes later.'
        }>
        <SettingsRow
          first
          Icon={chat?.muted ? BellSlashIcon : BellIcon}
          label={chat?.muted ? 'Muted' : 'On'}
          value={chat?.muted ? 'Tap to unmute' : 'Tap to mute this group'}
          onPress={() => (chat?.muted ? mute(false) : setMuteSheet(true))}
        />
      </SettingsGroup>
      {muteError ? <Text style={styles.error}>{muteError}</Text> : null}

      <Text style={styles.sectionTitle} accessibilityRole="header">
        Members
      </Text>
    </View>
  );

  return (
    <Screen style={styles.screen}>
      <BackHeader title="Group details" />
      <FlatList
        data={members}
        keyExtractor={(m) => m.user_id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.content}
        onEndReached={() => more && !failed && members.length > 0 && load(members[members.length - 1])}
        onEndReachedThreshold={0.5}
        renderItem={({ item, index }) => {
          const isMe = item.user_id === me;
          const detail = [isMe ? 'You' : null, item.is_admin ? 'Admin' : null, programme ? item.institution : null]
            .filter(Boolean)
            .join(' · ');
          return (
            <PressableScale
              onPress={() => router.push({ pathname: '/people/[id]', params: { id: item.user_id } })}
              scale={0.985}
              accessibilityRole="button"
              accessibilityLabel={detail ? `${item.full_name}, ${detail}` : item.full_name}
              style={[styles.member, index === 0 && styles.memberFirst, index === members.length - 1 && !more && styles.memberLast]}>
              <Avatar name={item.full_name} path={item.avatar_path} size={44} />
              <View style={styles.memberText}>
                <Text style={styles.memberName} numberOfLines={1}>
                  {item.full_name}
                </Text>
                {detail ? (
                  <Text style={styles.memberDetail} numberOfLines={1}>
                    {detail}
                  </Text>
                ) : null}
              </View>
            </PressableScale>
          );
        }}
        ListEmptyComponent={
          loading ? null : (
            <Text style={styles.note}>{failed ? 'Could not load members. Check your connection.' : 'No members to show.'}</Text>
          )
        }
        ListFooterComponent={
          loading ? (
            <ActivityIndicator style={styles.spinner} color={brand.red} />
          ) : failed && members.length > 0 ? (
            <PressableScale onPress={() => load(members[members.length - 1])} accessibilityRole="button" style={styles.retry}>
              <Text style={[styles.retryText, { color: theme.text }]}>Could not load more. Tap to try again.</Text>
            </PressableScale>
          ) : null
        }
      />

      <ActionSheet
        visible={muteSheet}
        title="Mute this group?"
        message="Messages still arrive. Your phone stays quiet."
        actions={[
          { label: 'For 8 hours', onPress: () => mute(true, 8) },
          { label: 'For 1 week', onPress: () => mute(true, 168) },
          { label: 'Until I unmute', onPress: () => mute(true) },
        ]}
        onClose={() => setMuteSheet(false)}
      />
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  content: { paddingHorizontal: space.xl, paddingBottom: space.xxxl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  headerStack: { gap: space.xl, paddingTop: space.sm, paddingBottom: space.sm },
  identity: { alignItems: 'center', gap: space.xs },
  iconPlaceholder: { width: 88, height: 88, borderRadius: 28, backgroundColor: t.surface },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: t.text, textAlign: 'center', marginTop: space.sm },
  subtitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: t.textMuted, textAlign: 'center' },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted, paddingHorizontal: space.xs, marginBottom: -space.md },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + 2,
    backgroundColor: t.surface,
  },
  memberFirst: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: space.md },
  memberLast: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, paddingBottom: space.md },
  memberText: { flex: 1, gap: 1 },
  memberName: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  memberDetail: { fontFamily: fonts.body, fontSize: 14, color: t.textMuted },
  note: { fontFamily: fonts.body, fontSize: 15, color: t.textMuted, paddingTop: space.md },
  error: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.dangerText, marginTop: -space.md },
  spinner: { paddingVertical: space.lg },
  retry: { alignSelf: 'center', padding: space.lg },
  retryText: { fontFamily: fonts.bodyBold, fontSize: 14 },
}));
