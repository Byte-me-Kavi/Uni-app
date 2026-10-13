import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { loadDirectory, setConsent, type Directory } from '@/lib/privacy';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// Your batch directory: batchmates who chose to be listed. Only your batch sees it.
export default function BatchDirectory() {
  const theme = useTheme();
  const styles = useStyles();
  const [d, setD] = useState<Directory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadDirectory().then((r) => (r.error !== null ? setError(r.error) : setD(r.data)));
  }, []);

  async function list(on: boolean) {
    setSaving(true);
    await setConsent('batch_directory', on);
    const r = await loadDirectory();
    setSaving(false);
    if (r.data) setD(r.data);
  }

  return (
    <Screen style={styles.screen} edges={['top']}>
      <BackHeader title="Your batch" />
      {!d ? (
        <View style={styles.center}>
          {error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} />}
        </View>
      ) : (
        <FlatList
          data={d.people}
          keyExtractor={(p) => p.user_id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.header}>
              <Text style={styles.batch}>{d.batch}</Text>
              <Text style={styles.meta}>
                {d.people.length} of {d.members} batchmates chose to be listed. Only your batch sees this list.
              </Text>
              <Button
                label={d.listed ? 'Take me off the list' : 'Add me to the list'}
                variant="quiet"
                loading={saving}
                onPress={() => list(!d.listed)}
              />
            </View>
          }
          ListEmptyComponent={<Text style={styles.empty}>Nobody is listed yet.</Text>}
          renderItem={({ item }) => (
            <PressableScale
              onPress={() => router.push({ pathname: '/people/[id]', params: { id: item.user_id } })}
              accessibilityRole="button"
              style={styles.row}>
              <Avatar name={item.full_name} path={item.avatar_path} size={44} />
              <View style={styles.rowText}>
                <Text style={styles.name}>
                  {item.full_name}
                  {item.you ? ' (you)' : ''}
                </Text>
                {item.fresher ? <Text style={styles.meta}>Fresher</Text> : null}
              </View>
            </PressableScale>
          )}
        />
      )}
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  list: { padding: space.xl, paddingTop: space.sm, gap: space.xs, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { gap: space.sm, marginBottom: space.md },
  batch: { fontFamily: fonts.bodyBold, fontSize: 18, color: t.text },
  meta: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
  empty: { fontFamily: fonts.body, fontSize: 15, color: t.textMuted, textAlign: 'center', marginTop: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderRadius: radius.md },
  rowText: { flex: 1, gap: 1 },
  name: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: t.text },
}));
