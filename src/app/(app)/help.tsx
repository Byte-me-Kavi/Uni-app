import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { HelpList } from '@/components/safety/help-list';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import type { HelpContacts } from '@/lib/help';
import { createThemedStyles, fonts, radius, space } from '@/theme/tokens';

// Account, Get help: who to call about ragging, threats or how you feel, at your university and
// nationally, and how reporting in the app works.
export default function Help() {
  const styles = useStyles();
  const [help, setHelp] = useState<HelpContacts | null>(null);
  return (
    <Screen style={styles.screen} edges={['top']}>
      <BackHeader title="Get help" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.lead}>
          Ragging is a crime, and you never have to deal with it alone. Call someone below, or report it in the app.
        </Text>
        <HelpList onLoaded={setHelp} />
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Reporting in Uni Era</Text>
          <Text style={styles.cardText}>
            Long-press a message, or use the menu on a post, profile or listing. Ragging, threats and self-harm are looked at
            first, within 2 hours. The person is never told who reported them.
          </Text>
          <Button label="Read the community guidelines" variant="quiet" onPress={() => router.push('/guidelines')} />
        </View>
        {help?.can_edit ? (
          <Button label="Edit these contacts" variant="quiet" onPress={() => router.push('/admin/help-contacts')} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  content: { padding: space.xl, paddingTop: space.sm, gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  lead: { fontFamily: fonts.bodySemiBold, fontSize: 16, lineHeight: 23, color: t.text },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  cardText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.text },
}));
