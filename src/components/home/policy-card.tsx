import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { BookOpenTextIcon } from 'phosphor-react-native/src/icons/BookOpenText';

import { Button } from '@/components/ui/button';
import { loadConsents } from '@/lib/privacy';
import { onSignOut } from '@/lib/resets';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// Checked once per launch, and again after the guidelines screen closes.
let known: boolean | null = null;
// The next account may not have accepted the new version.
onSignOut(() => {
  known = null;
});

// Home: the community guidelines (or another policy the app cannot work without) changed since the
// student agreed. One card until they read and accept the new version.
export function PolicyCard() {
  const theme = useTheme();
  const styles = useStyles();
  const [needed, setNeeded] = useState(known ?? false);

  useFocusEffect(
    useCallback(() => {
      if (known === false) return;
      let live = true;
      loadConsents().then((r) => {
        if (!live || !r.data) return;
        known = r.data.needs_reconsent;
        setNeeded(known);
      });
      return () => {
        live = false;
      };
    }, []),
  );

  if (!needed) return null;
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <BookOpenTextIcon size={22} weight="bold" color={theme.onAccentTint} />
        <Text style={styles.title}>We updated the community guidelines</Text>
      </View>
      <Text style={styles.body}>Read what changed and accept them to keep using Uni Era as before.</Text>
      <Button label="Read and accept" onPress={() => router.push({ pathname: '/guidelines', params: { accept: '1' } })} />
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  card: { backgroundColor: t.accentTint, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 16, color: t.onAccentTint },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.onAccentTint },
}));
