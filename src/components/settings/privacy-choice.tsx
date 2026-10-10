import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { OptionList } from '@/components/settings/option-list';
import { BackHeader } from '@/components/ui/back-header';
import { Screen } from '@/components/ui/screen';
import { supabase } from '@/lib/supabase';
import { FINDABLE, useAccount, WHO_CAN_MESSAGE, type Findable, type WhoCanMessage } from '@/lib/use-account';
import { createThemedStyles, fonts, space } from '@/theme/tokens';

type Setting = 'findable_by' | 'who_can_message';

const COPY = {
  findable_by: {
    title: 'Who can find me',
    lead: 'Who can find you by name in search. Your batchmates see you in your batch group either way.',
    note: 'Search shows your name, photo, university and batch. Never your email.',
  },
  who_can_message: {
    title: 'Who can message me',
    lead: 'Who can start a new chat with you. Group chats you are in are not affected.',
    note: 'Takes effect when Chats opens. Blocked students can never message you.',
  },
} as const;

// One privacy choice. Applies on tap and puts the old choice back if saving fails.
export function PrivacyChoice({ setting }: { setting: Setting }) {
  const styles = useStyles();
  const { account, setAccount } = useAccount();
  const [error, setError] = useState(false);
  const copy = COPY[setting];

  async function choose(value: Findable | WhoCanMessage) {
    if (!account || account[setting] === value) return;
    const previous = account[setting];
    setAccount({ ...account, [setting]: value });
    setError(false);
    const { error: saveError } = await supabase.rpc('update_privacy',
      setting === 'findable_by' ? { p_findable_by: value } : { p_who_can_message: value });
    if (saveError) {
      setAccount((a) => (a ? { ...a, [setting]: previous } : a));
      setError(true);
    }
  }

  return (
    <Screen style={styles.screen}>
      <BackHeader title={copy.title} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.lead}>{copy.lead}</Text>
        {setting === 'findable_by' ? (
          <OptionList options={FINDABLE} value={account?.findable_by} onChange={choose} disabled={!account} />
        ) : (
          <OptionList options={WHO_CAN_MESSAGE} value={account?.who_can_message} onChange={choose} disabled={!account} />
        )}
        <View>
          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              Could not save this. Check your connection and try again.
            </Text>
          ) : (
            <Text style={styles.note}>{copy.note}</Text>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  content: { padding: space.xl, paddingTop: space.sm, gap: space.lg, width: '100%', maxWidth: 560, alignSelf: 'center' },
  lead: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: t.textMuted },
  note: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
  error: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 19, color: t.dangerText },
}));
