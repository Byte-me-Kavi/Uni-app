import { Linking, Text } from 'react-native';

import { AuthChrome } from '@/components/auth/auth-chrome';
import { AuthScreen } from '@/components/auth/auth-screen';
import { Reveal } from '@/components/motion/reveal';
import { Button } from '@/components/ui/button';
import { appVersion, useStoreUrl } from '@/lib/app-config';
import { createThemedStyles, fonts } from '@/theme/tokens';

// Shown instead of the whole app when this build is older than app.min_version: an old build may
// call functions that no longer exist, so it stops here rather than half-working.
export function UpdateRequired() {
  const styles = useStyles();
  const url = useStoreUrl();
  return (
    <AuthChrome>
      <AuthScreen
        title="Update Uni Era"
        subtitle={`This version (${appVersion}) is too old to keep working. Update to carry on where you left off; your chats and files are safe.`}>
        <Reveal order={2}>
          {url ? (
            <Button label="Update" onPress={() => Linking.openURL(url)} />
          ) : (
            <Text style={styles.help}>Open the App Store and update Uni Era.</Text>
          )}
        </Reveal>
      </AuthScreen>
    </AuthChrome>
  );
}

const useStyles = createThemedStyles((t) => ({
  help: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 21, color: t.textMuted },
}));
