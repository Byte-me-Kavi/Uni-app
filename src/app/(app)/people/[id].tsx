import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { CaretLeftIcon } from 'phosphor-react-native/src/icons/CaretLeft';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { supabase } from '@/lib/supabase';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Person = {
  user_id: string;
  full_name: string;
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
  return (
    <View style={styles.stack}>
      <View style={styles.identity}>
        <Avatar name={person.full_name} size={88} />
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
        </View>
      ) : null}
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
  note: { paddingTop: space.xxl, gap: space.xs, alignItems: 'center' },
  noteTitle: { fontFamily: fonts.bodyBold, fontSize: 18, color: t.text, textAlign: 'center' },
  noteBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted, textAlign: 'center' },
  skeletonAvatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: t.surface },
  skeletonLine: { height: 16, borderRadius: radius.sm, backgroundColor: t.surface, marginTop: space.sm },
}));
