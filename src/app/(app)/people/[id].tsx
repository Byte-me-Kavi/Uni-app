import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { ActionSheet } from '@/components/ui/action-sheet';
import { Avatar } from '@/components/ui/avatar';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { startDirect } from '@/lib/chat/engine';
import { openChat } from '@/lib/chat/open-chat';
import { supabase } from '@/lib/supabase';
import { clearSearchCache } from '@/lib/use-people-search';
import { createThemedStyles, fonts, radius, space } from '@/theme/tokens';

type Person = {
  user_id: string;
  full_name: string;
  avatar_path: string | null;
  bio: string | null;
  institution: { name: string; short_name: string | null };
  batch: { name: string; programme: string; intake_year: number } | null;
  relation: 'you' | 'batchmate' | 'university' | null;
  blocked: false;
};

// What api.person returns for a student you blocked: just enough to recognise them and unblock.
type BlockedPerson = { user_id: string; full_name: string; avatar_path: string | null; blocked: true };

type State =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; person: Person | BlockedPerson };

const RELATION = { you: 'This is you', batchmate: 'Your batchmate', university: 'At your university' } as const;

// A student's card, opened from search: name, university and batch. Messaging opens with Chats.
export default function PersonScreen() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('person', { p_user_id: id });
    if (error) setState({ status: 'error' });
    else if (!data) setState({ status: 'missing' });
    else setState({ status: 'ready', person: data as Person | BlockedPerson });
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Screen style={styles.screen}>
      <BackHeader />

      <ScrollView contentContainerStyle={styles.content}>
        {state.status === 'loading' ? (
          <View style={styles.identity} accessible accessibilityLabel="Loading">
            <View style={styles.skeletonAvatar} />
            <View style={[styles.skeletonLine, { width: '60%', height: 26 }]} />
            <View style={[styles.skeletonLine, { width: '35%' }]} />
          </View>
        ) : null}

        {/* Also what a student who blocked you sees: a block is never revealed to the person blocked. */}
        {state.status === 'missing' || state.status === 'error' ? (
          <View style={styles.note}>
            <Text style={styles.noteTitle}>
              {state.status === 'missing' ? 'This student isn’t available' : 'Could not load this student'}
            </Text>
            <Text style={styles.noteBody}>
              {state.status === 'missing' ? 'They may have changed who can find them.' : 'Check your connection and try again.'}
            </Text>
          </View>
        ) : null}

        {state.status === 'ready' && state.person.blocked ? <BlockedCard person={state.person} onChange={load} /> : null}
        {state.status === 'ready' && !state.person.blocked ? <PersonCard person={state.person} onChange={load} /> : null}
      </ScrollView>
    </Screen>
  );
}

function PersonCard({ person, onChange }: { person: Person; onChange: () => void }) {
  const styles = useStyles();
  const relation = person.relation ? RELATION[person.relation] : null;
  const firstName = person.full_name.split(' ')[0];
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  // Opens (or creates) the direct chat. The server applies their "who can message me" setting.
  async function message() {
    setError(null);
    setOpening(true);
    const result = await startDirect(person);
    setOpening(false);
    if ('error' in result) setError(result.error ?? 'Could not open the chat. Try again.');
    else openChat(result.conversationId);
  }

  async function block() {
    setError(null);
    const { error: blockError } = await supabase.rpc('block_user', { p_user_id: person.user_id });
    if (blockError) {
      setError('Could not block. Check your connection and try again.');
      return;
    }
    clearSearchCache(); // so search shows them as blocked straight away
    onChange();
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
        <Row label="Batch" value={person.batch?.name ?? 'Not joined yet'} />
        {person.bio ? <Row label="About" value={person.bio} /> : null}
      </View>

      {person.relation !== 'you' ? (
        <View style={styles.actions}>
          <Button label={`Message ${firstName}`} onPress={message} loading={opening} />
          <PressableScale
            onPress={() => setConfirmBlock(true)}
            accessibilityRole="button"
            accessibilityLabel={`Block ${person.full_name}`}
            style={styles.block}>
            <Text style={styles.blockText}>Block {firstName}</Text>
          </PressableScale>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      ) : null}

      <ActionSheet
        visible={confirmBlock}
        title={`Block ${person.full_name}?`}
        message="They will not be able to find you, see your profile or message you, and they will not be told. You can unblock them from here or from your profile."
        actions={[{ label: 'Block', destructive: true, onPress: block }]}
        onClose={() => setConfirmBlock(false)}
      />
    </View>
  );
}

// A student you blocked: who they are, what the block does, and the way back.
function BlockedCard({ person, onChange }: { person: BlockedPerson; onChange: () => void }) {
  const styles = useStyles();
  const firstName = person.full_name.split(' ')[0];
  const [confirm, setConfirm] = useState(false);
  const [unblocking, setUnblocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unblock() {
    setError(null);
    setUnblocking(true);
    const { error: unblockError } = await supabase.rpc('unblock_user', { p_user_id: person.user_id });
    setUnblocking(false);
    if (unblockError) {
      setError(`Could not unblock ${firstName}. Check your connection and try again.`);
      return;
    }
    clearSearchCache();
    onChange(); // shows their full card again, if their privacy settings allow
  }

  return (
    <View style={styles.stack}>
      <View style={styles.identity}>
        <Avatar name={person.full_name} path={person.avatar_path} size={96} />
        <Text style={styles.name} accessibilityRole="header">
          {person.full_name}
        </Text>
        <Text style={styles.blockedLine}>You blocked {firstName}</Text>
      </View>

      <View style={styles.list}>
        <Text style={styles.blockedBody}>
          {firstName} cannot find you, see your profile or message you. They have not been told.
        </Text>
      </View>

      <View style={styles.actions}>
        <Button label={`Unblock ${firstName}`} variant="quiet" onPress={() => setConfirm(true)} loading={unblocking} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <ActionSheet
        visible={confirm}
        title={`Unblock ${person.full_name}?`}
        message="They will be able to find you and see your profile again, depending on your privacy settings."
        actions={[{ label: 'Unblock', onPress: unblock }]}
        onClose={() => setConfirm(false)}
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
  blockedLine: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.dangerText },
  blockedBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: t.text },
  list: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg, gap: space.lg },
  row: { gap: 2 },
  rowLabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.textMuted },
  rowValue: { fontFamily: fonts.bodySemiBold, fontSize: 16, lineHeight: 22, color: t.text },
  actions: { gap: space.sm },
  soon: { fontFamily: fonts.body, fontSize: 14, color: t.textMuted, textAlign: 'center' },
  block: { alignSelf: 'center', paddingHorizontal: space.lg, paddingVertical: space.md, marginTop: space.lg },
  blockText: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.dangerText },
  error: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.dangerText, textAlign: 'center' },
  note: { paddingTop: space.xxl, gap: space.xs, alignItems: 'center' },
  noteTitle: { fontFamily: fonts.bodyBold, fontSize: 18, color: t.text, textAlign: 'center' },
  noteBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted, textAlign: 'center' },
  skeletonAvatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: t.surface },
  skeletonLine: { height: 16, borderRadius: radius.sm, backgroundColor: t.surface, marginTop: space.sm },
}));
