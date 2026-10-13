import { router } from 'expo-router';
import { ScrollView } from 'react-native';

import { UniversityEmailForm } from '@/components/freshers/university-email-form';
import { BackHeader } from '@/components/ui/back-header';
import { Screen } from '@/components/ui/screen';
import { createThemedStyles, space } from '@/theme/tokens';

// From Home or the account screen: a fresher adds their university email when it arrives.
export default function UniversityEmail() {
  const styles = useStyles();
  return (
    <Screen style={styles.screen}>
      <BackHeader title="Your university email" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <UniversityEmailForm onDone={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  content: { padding: space.xl, paddingTop: space.sm, width: '100%', maxWidth: 560, alignSelf: 'center' },
}));
