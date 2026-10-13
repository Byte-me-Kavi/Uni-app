import { ScrollView } from 'react-native';

import { StandingView } from '@/components/safety/standing-view';
import { BackHeader } from '@/components/ui/back-header';
import { KeyboardFrame } from '@/components/ui/keyboard';
import { Screen } from '@/components/ui/screen';
import { createThemedStyles, space } from '@/theme/tokens';

// Account, Your standing: warnings, mutes and suspensions with their reasons, and appeals.
export default function StandingScreen() {
  const styles = useStyles();
  return (
    <Screen style={styles.screen} edges={['top']}>
      <BackHeader title="Your standing" />
      <KeyboardFrame style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <StandingView />
        </ScrollView>
      </KeyboardFrame>
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  flex: { flex: 1 },
  content: { padding: space.xl, paddingTop: space.sm, width: '100%', maxWidth: 560, alignSelf: 'center' },
}));
