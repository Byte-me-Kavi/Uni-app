import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { BellRingingIcon } from 'phosphor-react-native/src/icons/BellRinging';

import { Button } from '@/components/ui/button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { enablePush, pushStatus } from '@/lib/push';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

let dismissed = false; // "Not now" lasts until the app restarts

// Asks for notifications where they make sense, with the reason, instead of a cold system prompt
// at launch. Shown only while the phone has not been asked yet.
export function NotifyCard() {
  const theme = useTheme();
  const styles = useStyles();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (dismissed) return;
      pushStatus().then((status) => setShow(status === 'undetermined'));
    }, []),
  );

  if (!show) return null;

  async function turnOn() {
    setBusy(true);
    await enablePush().catch(() => false);
    setBusy(false);
    setShow(false);
  }

  return (
    <View style={styles.card}>
      <View style={styles.icon}>
        <BellRingingIcon size={24} weight="bold" color={theme.onAccent} />
      </View>
      <Text style={styles.title}>Know when someone messages you</Text>
      <Text style={styles.body}>
        Get direct messages as they arrive, even with the app closed. Busy groups notify you once, not for every message.
      </Text>
      <Button label="Turn on notifications" onPress={turnOn} loading={busy} />
      <PressableScale
        onPress={() => {
          dismissed = true;
          setShow(false);
        }}
        accessibilityRole="button"
        style={styles.later}>
        <Text style={styles.laterText}>Not now</Text>
      </PressableScale>
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  card: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm, margin: space.sm, marginBottom: space.md },
  icon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted, marginBottom: space.xs },
  later: { alignSelf: 'center', paddingHorizontal: space.lg, paddingVertical: space.sm },
  laterText: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.textMuted },
}));
