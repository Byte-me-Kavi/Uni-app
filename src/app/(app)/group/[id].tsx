import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TextInput, View } from 'react-native';
import { BellIcon } from 'phosphor-react-native/src/icons/Bell';
import { BellSlashIcon } from 'phosphor-react-native/src/icons/BellSlash';
import { FolderIcon } from 'phosphor-react-native/src/icons/Folder';
import { MegaphoneIcon } from 'phosphor-react-native/src/icons/Megaphone';
import { PencilSimpleIcon } from 'phosphor-react-native/src/icons/PencilSimple';
import { SignOutIcon } from 'phosphor-react-native/src/icons/SignOut';
import { TimerIcon } from 'phosphor-react-native/src/icons/Timer';
import { UserPlusIcon } from 'phosphor-react-native/src/icons/UserPlus';

import { ChatIcon, subtitleFor } from '@/components/chat/chat-row';
import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';
import { ActionSheet, type SheetAction } from '@/components/ui/action-sheet';
import { Avatar } from '@/components/ui/avatar';
import { BackHeader } from '@/components/ui/back-header';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { readCache, writeCache } from '@/lib/cache';
import { applyChatSettings, refreshChats, setMuted } from '@/lib/chat/engine';
import { useChat, useChatState } from '@/lib/chat/store';
import { supabase } from '@/lib/supabase';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Member = { user_id: string; full_name: string; avatar_path: string | null; institution: string; is_admin: boolean };
type Settings = {
  kind: string;
  title: string | null;
  slow_mode_seconds: number;
  announcement_only: boolean;
  member_count: number;
  my_role: 'admin' | 'member';
  /** A rep (batch and programme groups) or an admin (own groups): may change the settings below. */
  can_manage: boolean;
  /** May make others reps or admins: university moderators for a batch, national admins for a
   * programme group, admins for an own group. */
  can_appoint: boolean;
};

const PAGE = 50;
const SLOW_OPTIONS: { seconds: number; label: string }[] = [
  { seconds: 0, label: 'Off' },
  { seconds: 10, label: '10 seconds' },
  { seconds: 30, label: '30 seconds' },
  { seconds: 60, label: '1 minute' },
  { seconds: 300, label: '5 minutes' },
  { seconds: 900, label: '15 minutes' },
  { seconds: 3600, label: '1 hour' },
];
const slowLabel = (seconds: number) => SLOW_OPTIONS.find((o) => o.seconds === seconds)?.label ?? `${seconds} seconds`;

// A group's details: what it is, muting, its settings (for reps and admins), and its members by
// name. The first page of members comes from the phone (last visit) and refreshes behind it; the
// rest load as you scroll, so a national group of thousands opens as fast as a batch of forty.
//
// Batch and programme groups have reps (role "admin"), appointed by Uni Era's moderators, never by
// students themselves. Groups students create have admins, as in WhatsApp.
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
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sheet, setSheet] = useState<'mute' | 'slow' | 'send' | 'leave' | null>(null);
  const [memberMenu, setMemberMenu] = useState<Member | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const busy = useRef(false);

  const own = (settings?.kind ?? chat?.kind) === 'group';

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

  const loadSettings = useCallback(async () => {
    const { data } = await supabase.rpc('chat_settings', { p_conversation_id: id });
    if (data) setSettings(data as Settings);
  }, [id]);

  useEffect(() => {
    load(null);
    loadSettings();
  }, [load, loadSettings]);

  const report = (message: string | null) => setNote(message);

  async function mute(on: boolean, hours: number | null = null) {
    const error = await setMuted(id, on, hours);
    report(error ? 'Could not change this. Check your connection and try again.' : null);
  }

  async function change(patch: { slow?: number; announcement?: boolean; title?: string }) {
    const { data, error } = await supabase.rpc('update_chat_settings', {
      p_conversation_id: id,
      ...(patch.slow !== undefined ? { p_slow_mode_seconds: patch.slow } : {}),
      ...(patch.announcement !== undefined ? { p_announcement_only: patch.announcement } : {}),
      ...(patch.title !== undefined ? { p_title: patch.title } : {}),
    });
    if (error) {
      report(error.message);
      return false;
    }
    const next = data as { slow_mode_seconds: number; announcement_only: boolean; title: string | null };
    setSettings((s) => (s ? { ...s, ...next } : s));
    applyChatSettings(id, next);
    report(null);
    return true;
  }

  async function setRole(member: Member, role: 'admin' | 'member') {
    const { error } = await supabase.rpc('set_member_role', { p_conversation_id: id, p_user_id: member.user_id, p_role: role });
    if (error) return report(error.message);
    setMembers((list) => list.map((m) => (m.user_id === member.user_id ? { ...m, is_admin: role === 'admin' } : m)));
    if (member.user_id === me) {
      applyChatSettings(id, { my_role: role });
      loadSettings();
    }
    report(null);
  }

  async function remove(member: Member) {
    const { error } = await supabase.rpc('remove_group_member', { p_conversation_id: id, p_user_id: member.user_id });
    if (error) return report(error.message);
    setMembers((list) => list.filter((m) => m.user_id !== member.user_id));
    setSettings((s) => (s ? { ...s, member_count: s.member_count - 1 } : s));
  }

  async function leave() {
    const { error } = await supabase.rpc('leave_group', { p_conversation_id: id });
    if (error) return report(error.message);
    await refreshChats();
    router.dismissTo('/chats');
  }

  function memberActions(member: Member): SheetAction[] {
    const actions: SheetAction[] = [
      { label: 'View profile', onPress: () => router.push({ pathname: '/people/[id]', params: { id: member.user_id } }) },
    ];
    if (settings?.can_appoint) {
      actions.push(
        member.is_admin
          ? { label: own ? 'Dismiss as admin' : 'Remove as rep', onPress: () => setRole(member, 'member') }
          : { label: own ? 'Make group admin' : 'Make batch rep', onPress: () => setRole(member, 'admin') },
      );
    }
    if (own && settings?.my_role === 'admin' && member.user_id !== me) {
      actions.push({ label: `Remove ${member.full_name.split(' ')[0]}`, destructive: true, onPress: () => remove(member) });
    }
    return actions;
  }

  // Tapping a member opens their profile, unless there is something more to do with them.
  function openMember(member: Member) {
    if (memberActions(member).length > 1) setMemberMenu(member);
    else router.push({ pathname: '/people/[id]', params: { id: member.user_id } });
  }

  const programme = chat?.kind === 'programme';
  const title = settings?.title ?? chat?.title ?? ' ';
  const count = settings?.member_count ?? chat?.member_count ?? 0;
  const header = (
    <View style={styles.headerStack}>
      <View style={styles.identity}>
        {chat ? <ChatIcon chat={chat} size={88} /> : <View style={styles.iconPlaceholder} />}
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.subtitle}>
          {chat ? `${subtitleFor(chat) ?? 'Group'} · ${count.toLocaleString()} members` : ' '}
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
          onPress={() => (chat?.muted ? mute(false) : setSheet('mute'))}
        />
      </SettingsGroup>

      {settings?.can_manage ? (
        <SettingsGroup
          title={own ? 'Group settings' : 'Rep tools'}
          footer={
            own
              ? 'Only admins see these.'
              : 'Only reps see these. Reps are chosen by the Uni Era team, and changes are recorded.'
          }>
          {own ? (
            <SettingsRow
              first
              Icon={PencilSimpleIcon}
              label="Group name"
              value={title}
              onPress={() => {
                setName(title.trim());
                setRenaming(true);
              }}
            />
          ) : null}
          <SettingsRow
            first={!own}
            Icon={MegaphoneIcon}
            label="Who can send messages"
            value={settings.announcement_only ? (own ? 'Only admins' : 'Only reps') : 'Everyone'}
            onPress={() => setSheet('send')}
          />
          <SettingsRow
            Icon={TimerIcon}
            label="Slow mode"
            value={
              settings.slow_mode_seconds
                ? `Members wait ${slowLabel(settings.slow_mode_seconds)} between messages`
                : 'Off'
            }
            onPress={() => setSheet('slow')}
          />
        </SettingsGroup>
      ) : null}
      {note ? <Text style={styles.error}>{note}</Text> : null}

      <SettingsGroup title="Shared in this group">
        <SettingsRow
          first
          Icon={FolderIcon}
          label="Photos, documents and voice notes"
          value="Lecture notes, past papers and more"
          onPress={() => router.push({ pathname: '/chat-files/[id]', params: { id } })}
        />
      </SettingsGroup>

      {own && settings?.my_role === 'admin' ? (
        <SettingsGroup title="People">
          <SettingsRow
            first
            Icon={UserPlusIcon}
            label="Add members"
            value={`${count} of 100`}
            onPress={() => router.push({ pathname: '/new-group', params: { add: id } })}
          />
        </SettingsGroup>
      ) : null}

      <Text style={styles.sectionTitle} accessibilityRole="header">
        Members
      </Text>
    </View>
  );

  const footer = (
    <View>
      {loading ? (
        <ActivityIndicator style={styles.spinner} color={theme.accentText} />
      ) : failed && members.length > 0 ? (
        <PressableScale onPress={() => load(members[members.length - 1])} accessibilityRole="button" style={styles.retry}>
          <Text style={[styles.retryText, { color: theme.text }]}>Could not load more. Tap to try again.</Text>
        </PressableScale>
      ) : null}
      {own ? (
        <View style={styles.leave}>
          <SettingsGroup title="Leave">
            <SettingsRow first Icon={SignOutIcon} label="Leave group" onPress={() => setSheet('leave')} />
          </SettingsGroup>
        </View>
      ) : null}
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
          const detail = [
            isMe ? 'You' : null,
            item.is_admin ? (own ? 'Group admin' : 'Batch rep') : null,
            programme ? item.institution : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <PressableScale
              onPress={() => openMember(item)}
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
              {item.is_admin ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{own ? 'Admin' : 'Rep'}</Text>
                </View>
              ) : null}
            </PressableScale>
          );
        }}
        ListEmptyComponent={
          loading ? null : (
            <Text style={styles.note}>{failed ? 'Could not load members. Check your connection.' : 'No members to show.'}</Text>
          )
        }
        ListFooterComponent={footer}
      />

      <ActionSheet
        visible={sheet === 'mute'}
        title="Mute this group?"
        message="Messages still arrive. Your phone stays quiet."
        actions={[
          { label: 'For 8 hours', onPress: () => mute(true, 8) },
          { label: 'For 1 week', onPress: () => mute(true, 168) },
          { label: 'Until I unmute', onPress: () => mute(true) },
        ]}
        onClose={() => setSheet(null)}
      />
      <ActionSheet
        visible={sheet === 'send'}
        title="Who can send messages?"
        message={
          own
            ? 'Admins can always send.'
            : 'Use "Only reps" for announcements in a large batch: everyone still reads them. Reps can always send.'
        }
        actions={[
          { label: 'Everyone', onPress: () => change({ announcement: false }) },
          { label: own ? 'Only admins' : 'Only reps', onPress: () => change({ announcement: true }) },
        ]}
        onClose={() => setSheet(null)}
      />
      <ActionSheet
        visible={sheet === 'slow'}
        title="Slow mode"
        message={`Members wait this long between messages. ${own ? 'Admins' : 'Reps'} are not limited.`}
        actions={SLOW_OPTIONS.map((o) => ({ label: o.label, onPress: () => change({ slow: o.seconds }) }))}
        onClose={() => setSheet(null)}
      />
      <ActionSheet
        visible={sheet === 'leave'}
        title="Leave this group?"
        message="You will stop getting its messages. An admin can add you back."
        actions={[{ label: 'Leave group', destructive: true, onPress: leave }]}
        onClose={() => setSheet(null)}
      />
      <ActionSheet
        visible={!!memberMenu}
        title={memberMenu?.full_name}
        message={memberMenu && !own && settings?.can_appoint ? `Reps can switch on announcements and slow mode, and pin messages. Up to 5 per group.` : undefined}
        actions={memberMenu ? memberActions(memberMenu) : []}
        onClose={() => setMemberMenu(null)}
      />
      <BottomSheet visible={renaming} title="Group name" onClose={() => setRenaming(false)} height={0.5}>
        <View style={styles.rename}>
          <TextInput
            value={name}
            onChangeText={setName}
            autoFocus
            maxLength={80}
            style={styles.input}
            selectionColor={theme.accent}
            accessibilityLabel="Group name"
          />
          <Button
            label="Save"
            disabled={!name.trim() || name.trim() === title.trim()}
            onPress={async () => {
              if (await change({ title: name.trim() })) setRenaming(false);
            }}
          />
        </View>
      </BottomSheet>
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
  badge: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1, borderColor: t.border },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.text },
  note: { fontFamily: fonts.body, fontSize: 15, color: t.textMuted, paddingTop: space.md },
  error: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.dangerText, marginTop: -space.md },
  spinner: { paddingVertical: space.lg },
  retry: { alignSelf: 'center', padding: space.lg },
  retryText: { fontFamily: fonts.bodyBold, fontSize: 14 },
  leave: { marginTop: space.xl },
  rename: { paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.md },
  input: {
    height: 48,
    borderRadius: radius.md,
    backgroundColor: t.surface,
    paddingHorizontal: space.md,
    fontFamily: fonts.body,
    fontSize: 16,
    color: t.text,
  },
}));
