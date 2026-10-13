import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { EnvelopeSimpleIcon } from 'phosphor-react-native/src/icons/EnvelopeSimple';

import { Button } from '@/components/ui/button';
import { useSession } from '@/providers/session-provider';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

const DAY = 24 * 60 * 60 * 1000;

// Home, for freshers: what they can do now, what opens with the university email, and how long
// the fresher account lasts. One button, the one thing left to do.
export function FresherCard() {
  const theme = useTheme();
  const styles = useStyles();
  const session = useSession();
  const until = session.status === 'signed_in' ? session.claims.fresherUntil : null;
  const [now] = useState(() => Date.now());
  const days = until ? Math.max(0, Math.ceil((until - now) / DAY)) : null;
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <EnvelopeSimpleIcon size={20} weight="bold" color={theme.onAccent} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          You’re in as a fresher
        </Text>
      </View>
      <Text style={styles.body}>
        Chat with your batch, read posts and share notes, and ask seniors anything before you arrive. When your university gives
        you an email, add it to post, use the Shop and host kuppi.
      </Text>
      {days !== null && days <= 30 ? (
        <Text style={styles.warn}>{days === 0 ? 'Add it today to keep using Uni Era.' : `${days} days left to add it.`}</Text>
      ) : null}
      <Button label="Add university email" onPress={() => router.push('/university-email')} />
      <Button label="Ask the ambassadors" variant="quiet" onPress={() => router.push('/freshers')} />
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  card: { backgroundColor: t.accentTint, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  icon: { width: 34, height: 34, borderRadius: 17, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 17, color: t.onAccentTint },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.onAccentTint },
  warn: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.dangerText },
}));
