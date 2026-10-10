import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { CaretLeftIcon } from 'phosphor-react-native/src/icons/CaretLeft';

import { ActionSheet } from '@/components/ui/action-sheet';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { supabase } from '@/lib/supabase';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Person = {
  user_id: string;
  full_name: string;
  avatar_path: string | null;
  bio: string | null;
  institution: { name: string; short_name: string | null };
  batch: { programme: string; intake_year: number } | null;
  relation: 'you' | 'batchmate' | 'university' | null;
};

const RELATION = { you: 'This is you', batchmate: 'Your batchmate', university: 'At your university' } as const;

// A student's card, opened from search: name, university and batch. Messaging opens with Chats.
export default function PersonScreen() {
  const theme = useTheme();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'missing' } | { status: 'error' } | { status: 'ready'; person: Person }
  >({ status: 'loading' });

  useEffect(() => {
    let current = true;
    supabase.rpc('person', { p_user_id: id }).then(({ data, error }) => {
      if (!current) return;
      if (error) setState({ status: 'error' });
      else if (!data) setState({ status: 'missing' });
      else setState({ status: 'ready', person: data as Person });
    });
    return () => {
      current = false;
    };
  }, [id]);

  return (
    <Screen style={styles.screen}>
      <View style={styles.topBar}>
        <PressableScale
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          style={styles.back}>
          <CaretLeftIcon size={22} weight="bold" color={theme.text} />
        </PressableScale>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {state.status === 'loading' ? (
          <View style={styles.identity} accessible accessibilityLabel="Loading">
            <View style={styles.skeletonAvatar} />
            <View style={[styles.skeletonLine, { width: '60%', height: 26 }]} />
            <View style={[styles.skeletonLine, { width: '35%' }]} />
          </View>
        ) : null}

        {state.status === 'missing' || state.status === 'error' ? (
          <View style={styles.note}>
            <Text style={styles.noteTitle}>
              {state.status === 'missing' ? 'This student isn’t available' : 'Could not load this student'}
            </Text>
            <Text style={styles.noteBody}>
              {state.status === 'missing'
                ? 'They may have changed who can find them.'
                : 'Check your connection and try again.'}
            </Text>
          </View>
        ) : null}

        {state.status === 'ready' ? <PersonCard person={state.person} /> : null}
      </ScrollView>
    </Screen>
  );
}

function PersonCard({ person }: { person: Person }) {
  const styles = useStyles();
  const relation = person.relation ? RELATION[person.relation] : null;
  const firstName = person.full_name.split(' ')[0];
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  async function block() {
    setBlockError(null);
    const { error } = await supabase.rpc('block_user', { p_user_id: person.user_id });
    if (error) {
      setBlockError('Could not block. Check your connection and try again.');
      return;
    }
    router.back();
  }

  return (
    <View style={styles.stack}>
      <View style={styles.identity}>
        <Avatar name={person.full_name} path={person.avatar_path} size={96} />
        <Text style={styles.name} accessibilityRole="header">
          {person.full_name}
        </Text>
        {relation ? <Text style={styles.relation}>{relation}</Text> : null}
      </View>

      <View style={styles.list}>
        <Row label="University" value={person.institution.name} />
        <Row
          label="Batch"
          value={person.batch ? `${person.batch.programme}, ${person.batch.intake_year} intake` : 'Not joined yet'}
        />
        {person.bio ? <Row label="About" value={person.bio} /> : null}
      </View>

      {person.relation !== 'you' ? (
        <View style={styles.actions}>
          <Button label="Message" onPress={() => {}} disabled />
          <Text style={styles.soon}>Messages open soon, with Chats.</Text>
          <PressableScale
            onPress={() => setConfirmBlock(true)}
            accessibilityRole="button"
            accessibilityLabel={`Block ${person.full_name}`}
            style={styles.block}>
            <Text style={styles.blockText}>Block {firstName}</Text>
          </PressableScale>
          {blockError ? <Text style={styles.blockError}>{blockError}</Text> : null}
        </View>
      ) : null}

      <ActionSheet
        visible={confirmBlock}
        title={`Block ${person.full_name}?`}
        message="They will not be able to find you, see your profile or message you. They will not be told. You can unblock them in your profile."
        actions={[{ label: 'Block', destructive: true, onPress: block }]}
        onClose={() => setConfirmBlock(false)}
      />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, minHeight: 56 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { padding: space.xl, paddingTop: space.sm, width: '100%', maxWidth: 560, alignSelf: 'center' },
  stack: { gap: space.xl },
  identity: { alignItems: 'center', gap: space.sm, paddingBottom: space.sm },
  name: {
    fontFamily: fonts.display,
    fontSize: 26,
    lineHeight: 32,
    color: t.text,
    textAlign: 'center',
    marginTop: space.sm,
    letterSpacing: -0.2,
  },
  relation: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.textMuted },
  list: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg, gap: space.lg },
  row: { gap: 2 },
  rowLabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.textMuted },
  rowValue: { fontFamily: fonts.bodySemiBold, fontSize: 16, lineHeight: 22, color: t.text },
  actions: { gap: space.sm },
  soon: { fontFamily: fonts.body, fontSize: 14, color: t.textMuted, textAlign: 'center' },
  block: { alignSelf: 'center', paddingHorizontal: space.lg, paddingVertical: space.md, marginTop: space.lg },
  blockText: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.dangerText },
  blockError: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.dangerText, textAlign: 'center' },
  note: { paddingTop: space.xxl, gap: space.xs, alignItems: 'center' },
  noteTitle: { fontFamily: fonts.bodyBold, fontSize: 18, color: t.text, textAlign: 'center' },
  noteBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted, textAlign: 'center' },
  skeletonAvatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: t.surface },
  skeletonLine: { height: 16, borderRadius: radius.sm, backgroundColor: t.surface, marginTop: space.sm },
}));
