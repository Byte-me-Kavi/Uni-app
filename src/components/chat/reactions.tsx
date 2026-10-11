import { useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { react } from '@/lib/chat/engine';
import { useChatState } from '@/lib/chat/store';
import type { Reaction } from '@/lib/chat/types';
import { supabase } from '@/lib/supabase';
import { createThemedStyles, fonts, radius, space } from '@/theme/tokens';

// The reactions under a bubble: each emoji with its count; yours outlined. Tap to see who.
export function ReactionsRow({ reactions, mine, onPress }: { reactions: Reaction[]; mine: boolean; onPress: () => void }) {
  const styles = useStyles();
  const total = reactions.reduce((n, r) => n + r.count, 0);
  const shown = reactions.slice(0, 3);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${total} ${total === 1 ? 'reaction' : 'reactions'}: ${reactions.map((r) => `${r.emoji} ${r.count}`).join(', ')}. See who reacted`}
      style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      {shown.map((r) => (
        <Text key={r.emoji} style={styles.emoji}>
          {r.emoji}
        </Text>
      ))}
      {total > 1 ? <Text style={styles.count}>{total}</Text> : null}
    </Pressable>
  );
}

type Who = { user_id: string; full_name: string; avatar_path: string | null; emoji: string };

// The last list seen for each message: opening the same reactions again shows them at once and
// refreshes behind. Kept for the app session.
const seen = new Map<string, Who[]>();

// Who reacted with what, in a sheet over the lower half of the chat (as in WhatsApp): "All" and a
// tab for each emoji. Tap your own to take it back.
export function ReactionDetails({
  target,
  me,
  onClose,
}: {
  target: { conversationId: string; messageId: string } | null;
  me: string | null;
  onClose: () => void;
}) {
  const styles = useStyles();
  // The counts the chat already has: the tabs show these at once, before the names arrive.
  const summary = useChatState((s) => (target ? s.reactions[target.messageId] : undefined));
  const [rows, setRows] = useState<Who[] | null>(null);
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setFilter(null);
    setRows(seen.get(target.messageId) ?? null);
  }, [target]);

  // Fetched on open, and again when the counts change while it is open (someone reacted).
  useEffect(() => {
    if (!target) return;
    let live = true;
    supabase
      .rpc('reaction_details', { p_conversation_id: target.conversationId, p_message_id: target.messageId })
      .then(({ data, error }) => {
        if (error) return;
        const fresh = (data as Who[] | null) ?? [];
        seen.set(target.messageId, fresh);
        if (live) setRows(fresh);
      });
    return () => {
      live = false;
    };
  }, [target, summary]);

  // Yours first, then everyone else as the server ordered them (newest first).
  const all = rows ? [...rows.filter((r) => r.user_id === me), ...rows.filter((r) => r.user_id !== me)] : [];
  const counts = new Map<string, number>();
  if (rows) for (const r of all) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
  else for (const r of summary ?? []) counts.set(r.emoji, r.count);
  const total = [...counts.values()].reduce((n, c) => n + c, 0);
  const tabs = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const shown = filter ? all.filter((r) => r.emoji === filter) : all;

  return (
    <BottomSheet visible={!!target} onClose={onClose}>
      <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} style={styles.tabsBar}>
          {[[null, total] as const, ...tabs].map(([emoji, count]) => {
            const active = filter === emoji;
            return (
              <Pressable
                key={emoji ?? 'all'}
                onPress={() => setFilter(emoji)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={emoji ? `${emoji}, ${count}` : `All, ${count}`}
                style={[styles.tab, active && styles.tabActive]}>
                {emoji ? <Text style={styles.tabEmoji}>{emoji}</Text> : <Text style={styles.tabText}>All</Text>}
                <Text style={styles.tabText}>{count}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {rows === null ? (
          <PeopleSkeleton count={Math.min(total || 3, 6)} />
        ) : (
          <FlatList
            data={shown}
            keyExtractor={(r) => r.user_id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => {
              const isMe = item.user_id === me;
              return (
                <Pressable
                  disabled={!isMe}
                  onPress={() => {
                    if (!target) return;
                    react(target.conversationId, target.messageId, null);
                    onClose();
                  }}
                  accessibilityRole={isMe ? 'button' : undefined}
                  accessibilityLabel={isMe ? `Your reaction ${item.emoji}. Tap to remove` : `${item.full_name} reacted ${item.emoji}`}
                  style={({ pressed }) => [styles.person, pressed && styles.pressed]}>
                  <Avatar name={item.full_name} path={item.avatar_path} size={40} />
                  <View style={styles.text}>
                    <Text style={styles.name} numberOfLines={1}>
                      {isMe ? 'You' : item.full_name}
                    </Text>
                    {isMe ? <Text style={styles.hint}>Tap to remove</Text> : null}
                  </View>
                  <Text style={styles.bigEmoji}>{item.emoji}</Text>
                </Pressable>
              );
            }}
            ListEmptyComponent={<Text style={[styles.hint, styles.emptyNote]}>No reactions.</Text>}
          />
        )}
      </>
    </BottomSheet>
  );
}

/** Grey rows where people will appear, while their names load the first time. */
export function PeopleSkeleton({ count }: { count: number }) {
  const styles = useStyles();
  return (
    <View style={styles.list} accessible accessibilityLabel="Loading">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.person}>
          <View style={styles.skeletonAvatar} />
          <View style={[styles.skeletonLine, { width: `${55 - (i % 3) * 10}%` }]} />
        </View>
      ))}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: -6,
    paddingHorizontal: space.sm - 2,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: t.elevated,
    borderWidth: 1.5,
    borderColor: t.background,
  },
  rowMine: { alignSelf: 'flex-end', marginRight: space.sm },
  rowTheirs: { alignSelf: 'flex-start', marginLeft: space.sm },
  emoji: { fontSize: 15 },
  count: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: t.textMuted, marginLeft: 2 },
  skeletonAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.surface },
  skeletonLine: { height: 14, borderRadius: radius.sm, backgroundColor: t.surface },
  tabsBar: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: t.border },
  tabs: { paddingHorizontal: space.md, gap: space.xs },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: t.tickRead },
  tabEmoji: { fontSize: 18 },
  tabText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  list: { paddingHorizontal: space.md, paddingVertical: space.sm },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.md },
  pressed: { backgroundColor: t.elevatedPressed },
  emptyNote: { textAlign: 'center', padding: space.xl },
  text: { flex: 1 },
  name: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  hint: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  bigEmoji: { fontSize: 26 },
}));
