import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text } from 'react-native';

import { OptionList } from '@/components/settings/option-list';
import { BackHeader } from '@/components/ui/back-header';
import { Screen } from '@/components/ui/screen';
import { supabase } from '@/lib/supabase';
import { createThemedStyles, fonts, space } from '@/theme/tokens';

const OPTIONS = [
  { value: 'on', label: 'People I chat with', detail: 'Students you have a direct chat with see when you are online or last seen' },
  { value: 'off', label: 'Nobody', detail: 'Nobody sees it, and you do not see theirs' },
] as const;
type Choice = (typeof OPTIONS)[number]['value'];

// Last seen and online, as in WhatsApp: sharing is mutual.
export default function LastSeen() {
  const styles = useStyles();
  const [value, setValue] = useState<Choice | undefined>();
  const [error, setError] = useState(false);

  useFocusEffect(
    useCallback(() => {
      supabase.rpc('privacy_extras').then(({ data }) => {
        if (data) setValue((data as { show_last_seen: boolean }).show_last_seen ? 'on' : 'off');
      });
    }, []),
  );

  async function choose(next: Choice) {
    if (next === value) return;
    const previous = value;
    setValue(next);
    setError(false);
    const { error: saveError } = await supabase.rpc('set_show_last_seen', { p_on: next === 'on' });
    if (saveError) {
      setValue(previous);
      setError(true);
    }
  }

  return (
    <Screen style={styles.screen}>
      <BackHeader title="Last seen and online" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.lead}>Who sees when you are online, or when you last used Uni Era.</Text>
        <OptionList options={[...OPTIONS]} value={value} onChange={choose} disabled={!value} />
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            Could not save this. Check your connection and try again.
          </Text>
        ) : (
          <Text style={styles.note}>Only students you have a direct chat with can ever see it. Groups never show it.</Text>
        )}
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
