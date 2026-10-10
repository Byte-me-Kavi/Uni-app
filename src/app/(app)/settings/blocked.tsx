import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { ActionSheet } from '@/components/ui/action-sheet';
import { Avatar } from '@/components/ui/avatar';
import { BackHeader } from '@/components/ui/back-header';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { supabase } from '@/lib/supabase';
import { clearSearchCache } from '@/lib/use-people-search';
import { createThemedStyles, fonts, radius, space } from '@/theme/tokens';

type Blocked = { user_id: string; full_name: string; avatar_path: string | null; institution: string };

// Students you have blocked. They cannot find you, see your card or message you, and are not told.
export default function BlockedStudents() {
  const styles = useStyles();
  const [blocked, setBlocked] = useState<Blocked[] | null>(null);
  const [confirming, setConfirming] = useState<Blocked | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('blocked_users');
    if (loadError) setError('Could not load blocked students. Check your connection.');
    else setBlocked((data ?? []) as Blocked[]);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function unblock(student: Blocked) {
    setError(null);
    setBlocked((list) => list?.filter((b) => b.user_id !== student.user_id) ?? list);
    const { error: unblockError } = await supabase.rpc('unblock_user', { p_user_id: student.user_id });
    if (unblockError) {
      setError(`Could not unblock ${student.full_name}. Try again.`);
      load();
      return;
    }
    clearSearchCache();
  }

  return (
    <Screen style={styles.screen}>
      <BackHeader title="Blocked students" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.lead}>
          Blocked students cannot find you, see your profile or message you. They are not told.
        </Text>
        <FormMessage message={error} />

        {blocked === null && !error ? (
          <View style={styles.list} accessible accessibilityLabel="Loading">
            {[0, 1].map((i) => (
              <View key={i} style={styles.row}>
                <View style={styles.skeletonAvatar} />
                <View style={styles.skeletonLine} />
              </View>
            ))}
          </View>
        ) : null}

        {blocked?.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>You have not blocked anyone</Text>
            <Text style={styles.emptyBody}>To block someone, open their profile from search and choose Block.</Text>
          </View>
        ) : null}

        {blocked && blocked.length > 0 ? (
          <View style={styles.list}>
            {blocked.map((student, i) => (
              <View key={student.user_id} style={[styles.row, i > 0 && styles.divider]}>
                <Avatar name={student.full_name} path={student.avatar_path} size={44} />
                <View style={styles.text}>
                  <Text style={styles.name} numberOfLines={1}>
                    {student.full_name}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {student.institution}
                  </Text>
                </View>
                <PressableScale
                  onPress={() => setConfirming(student)}
                  accessibilityRole="button"
                  accessibilityLabel={`Unblock ${student.full_name}`}
                  style={styles.unblock}>
                  <Text style={styles.unblockText}>Unblock</Text>
                </PressableScale>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <ActionSheet
        visible={confirming !== null}
        title={confirming ? `Unblock ${confirming.full_name}?` : undefined}
        message="They will be able to find you and see your profile again, depending on your privacy settings."
        actions={confirming ? [{ label: 'Unblock', onPress: () => unblock(confirming) }] : []}
        onClose={() => setConfirming(null)}
      />
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  content: { padding: space.xl, paddingTop: space.sm, gap: space.lg, width: '100%', maxWidth: 560, alignSelf: 'center' },
  lead: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: t.textMuted },
  list: { backgroundColor: t.surface, borderRadius: radius.lg, paddingHorizontal: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  divider: { borderTopWidth: 1, borderTopColor: t.border },
  text: { flex: 1, gap: 1 },
  name: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  meta: { fontFamily: fonts.body, fontSize: 14, color: t.textMuted },
  unblock: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: t.borderFilled,
  },
  unblockText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  empty: { paddingTop: space.lg, gap: space.xs },
  emptyTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  emptyBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted },
  skeletonAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: t.background },
  skeletonLine: { flex: 1, height: 16, borderRadius: radius.sm, backgroundColor: t.background },
}));
