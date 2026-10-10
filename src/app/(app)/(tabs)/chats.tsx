import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { UsersThreeIcon } from 'phosphor-react-native/src/icons/UsersThree';

import { ChatRow } from '@/components/chat/chat-row';
import { Button } from '@/components/ui/button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { refreshChats } from '@/lib/chat/engine';
import { useChatState } from '@/lib/chat/store';
import type { Chat } from '@/lib/chat/types';
import { useHomeData } from '@/providers/home-provider';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// The Chats tab: your batch group, your national programme group and direct messages, newest
// first, drawn from the phone's copy at once and refreshed from the server when the tab opens.
// Message requests from other universities wait under Requests.
export default function Chats() {
  const theme = useTheme();
  const styles = useStyles();
  const chats = useChatState((s) => s.chats);
  const loaded = useChatState((s) => s.chatsLoaded);
  const me = useChatState((s) => s.me);
  const { state: home } = useHomeData();
  const [section, setSection] = useState<'chats' | 'requests'>('chats');
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshChats();
    }, []),
  );

  const requests = chats.filter((c) => c.request === 'incoming');
  const visible = section === 'requests' ? requests : chats.filter((c) => c.request !== 'incoming');
  const hasBatch = home.status === 'ready' ? home.home.has_cohort : true;

  async function refresh() {
    setRefreshing(true);
    await refreshChats();
    setRefreshing(false);
  }

  const open = (chat: Chat) => router.push({ pathname: '/chat/[id]', params: { id: chat.conversation_id } });

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.heading} accessibilityRole="header">
          Chats
        </Text>
        {requests.length > 0 || section === 'requests' ? (
          <View style={styles.segments} accessibilityRole="tablist">
            {(['chats', 'requests'] as const).map((key) => (
              <PressableScale
                key={key}
                onPress={() => setSection(key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: section === key }}
                style={[styles.segment, section === key && styles.segmentActive]}>
                <Text style={[styles.segmentText, section === key && styles.segmentTextActive]}>
                  {key === 'chats' ? 'Chats' : `Requests${requests.length ? ` (${requests.length})` : ''}`}
                </Text>
              </PressableScale>
            ))}
          </View>
        ) : null}
      </View>

      <FlatList
        data={visible}
        keyExtractor={(c) => c.conversation_id}
        renderItem={({ item }) => <ChatRow chat={item} me={me} onPress={() => open(item)} />}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={brand.red} colors={[brand.red]} />
        }
        ListHeaderComponent={
          !hasBatch && section === 'chats' ? (
            <View style={styles.joinCard}>
              <View style={styles.joinIcon}>
                <UsersThreeIcon size={24} weight="bold" color={brand.ink} />
              </View>
              <Text style={styles.joinTitle}>Join your batch</Text>
              <Text style={styles.joinBody}>
                You get your batch group and a national group for your degree, with students from every university.
              </Text>
              <Button label="Find my batch" onPress={() => router.push('/batch')} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          !loaded ? (
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
                  : 'Search for a student at the top and open their profile to message them.'}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          section === 'chats' && visible.length > 0 ? (
            <Text style={[styles.footer, { color: theme.textMuted }]}>
              To message someone new, search for them at the top.
            </Text>
          ) : null
        }
      />
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { flex: 1 },
  header: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.sm, gap: space.md, width: '100%', maxWidth: 560, alignSelf: 'center' },
  heading: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: t.text, letterSpacing: -0.3 },
  segments: { flexDirection: 'row', gap: space.sm },
  segment: { paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: t.surface },
  segmentActive: { backgroundColor: t.focus },
  segmentText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  segmentTextActive: { color: t.background },
  list: { paddingHorizontal: space.xl - space.sm, paddingBottom: space.xxxl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  joinCard: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm, margin: space.sm, marginBottom: space.md },
  joinIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: brand.red, alignItems: 'center', justifyContent: 'center' },
  joinTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  joinBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted, marginBottom: space.xs },
  empty: { paddingHorizontal: space.sm, paddingTop: space.xl, gap: space.xs },
  emptyTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  emptyBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted },
  footer: { fontFamily: fonts.body, fontSize: 13, textAlign: 'center', paddingTop: space.xl },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm },
  skeletonIcon: { width: 52, height: 52, borderRadius: 17, backgroundColor: t.surface },
  skeletonText: { flex: 1, gap: space.sm },
  skeletonLine: { height: 14, borderRadius: radius.sm, backgroundColor: t.surface },
}));
