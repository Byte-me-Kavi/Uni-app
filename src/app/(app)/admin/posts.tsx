import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';

import { PostCard } from '@/components/feed/post-card';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { Screen } from '@/components/ui/screen';
import { loadReview, putPosts, reviewPost, type ReviewPost } from '@/lib/feed';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// Moderators: feed posts students reported at the universities they look after, oldest first.
// Posts three students reported are already hidden. Restore puts a post back (the reports are
// dismissed); Remove takes it down and tells the author.
export default function ReviewPostsScreen() {
  const theme = useTheme();
  const styles = useStyles();
  const [posts, setPosts] = useState<ReviewPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      loadReview().then((r) => {
        if (!live) return;
        if (r.data) {
          putPosts(r.data);
          setPosts(r.data);
        }
        setError(r.error);
      });
      return () => {
        live = false;
      };
    }, []),
  );

  async function decide(id: number, action: 'restore' | 'remove') {
    setBusy(id);
    const r = await reviewPost(id, action);
    setBusy(null);
    if (r.error) return setError(r.error);
    setPosts((all) => all?.filter((p) => p.id !== id) ?? null);
  }

  return (
    <Screen style={styles.screen}>
      <BackHeader title="Reported posts" />
      {!posts ? (
        <View style={styles.center}>
          {error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} />}
        </View>
      ) : (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.content}
          data={posts}
          keyExtractor={(p) => String(p.id)}
          ListHeaderComponent={<FormMessage message={error} />}
          ListEmptyComponent={<Text style={styles.empty}>Nothing to review. Reported posts show up here.</Text>}
          ItemSeparatorComponent={Gap}
          renderItem={({ item }) => (
            <View style={styles.item}>
              <Text style={styles.meta}>
                {item.university} · {item.status === 'hidden' ? 'Hidden after reports' : 'Still showing'}
              </Text>
              <PostCard id={item.id} full />
              <View style={styles.reports}>
                {(item.reports ?? []).map((r, i) => (
                  <Text key={i} style={styles.reason}>
                    {r.category}
                    {r.details ? `: ${r.details}` : ''}
                  </Text>
                ))}
              </View>
              <View style={styles.buttons}>
                <View style={styles.flex}>
                  <Button label="Restore" variant="quiet" onPress={() => decide(item.id, 'restore')} disabled={busy !== null} />
                </View>
                <View style={styles.flex}>
                  <Button
                    label="Remove"
                    onPress={() => decide(item.id, 'remove')}
                    loading={busy === item.id}
                    disabled={busy !== null}
                  />
                </View>
              </View>
            </View>
          )}
        />
      )}
    </Screen>
  );
}

function Gap() {
  return <View style={{ height: space.xl }} />;
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  list: { flex: 1, width: '100%', maxWidth: 608, alignSelf: 'center' },
  content: { padding: space.xl, paddingTop: space.sm, paddingBottom: space.xxxl },
  flex: { flex: 1 },
  item: { gap: space.sm },
  meta: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.textMuted },
  reports: { gap: 4, backgroundColor: t.surface, borderRadius: radius.md, padding: space.md },
  reason: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.text },
  buttons: { flexDirection: 'row', gap: space.md },
  empty: { fontFamily: fonts.body, fontSize: 15, color: t.textMuted, textAlign: 'center', paddingVertical: space.xl },
}));
