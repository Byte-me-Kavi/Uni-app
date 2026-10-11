import { useMemo, useState } from 'react';
import { Pressable, SectionList, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { readCache, writeCache } from '@/lib/cache';
import { EMOJI_GROUPS, emojiOnlyCount } from '@/lib/chat/emoji';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

const RECENT_KEY = 'emoji:recent';

/** Remembers emoji you use (reactions and messages), so they come first next time. */
export function rememberEmoji(emoji: string) {
  const recent = readCache<string[]>(RECENT_KEY) ?? [];
  writeCache(RECENT_KEY, [emoji, ...recent.filter((e) => e !== emoji)].slice(0, 24));
}

/**
 * Every emoji as plain Unicode text (the phone's own emoji font draws them, as in WhatsApp):
 * recently used first, then by group. Used for reactions and in the message box's emoji tab.
 */
export function EmojiGrid({ onPick, label = 'Send' }: { onPick: (emoji: string) => void; label?: string }) {
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const columns = Math.max(7, Math.min(12, Math.floor(Math.min(width, 640) / 48)));
  const [recent, setRecent] = useState(() => readCache<string[]>(RECENT_KEY) ?? []);

  const sections = useMemo(() => {
    const groups = recent.length ? [{ label: 'Recent', emoji: recent }, ...EMOJI_GROUPS] : EMOJI_GROUPS;
    return groups.map((g) => ({
      title: g.label,
      data: Array.from({ length: Math.ceil(g.emoji.length / columns) }, (_, i) => g.emoji.slice(i * columns, i * columns + columns)),
    }));
  }, [recent, columns]);

  function pick(emoji: string) {
    rememberEmoji(emoji);
    onPick(emoji);
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(row, i) => row.join('') + i}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="always"
      initialNumToRender={8}
      contentContainerStyle={styles.list}
      // Recents update when the grid is next shown, so it does not reshuffle under your finger.
      onMomentumScrollEnd={() => setRecent(readCache<string[]>(RECENT_KEY) ?? [])}
      renderSectionHeader={({ section }) => <Text style={styles.header}>{section.title}</Text>}
      renderItem={({ item }) => (
        <View style={styles.row}>
          {item.map((emoji) => (
            <Pressable
              key={emoji}
              onPress={() => pick(emoji)}
              accessibilityRole="button"
              accessibilityLabel={`${label} ${emoji}`}
              style={({ pressed }) => [styles.cell, pressed && styles.pressed]}>
              <Text style={styles.emoji}>{emoji}</Text>
            </Pressable>
          ))}
          {Array.from({ length: columns - item.length }, (_, i) => (
            <View key={`gap-${i}`} style={styles.cell} />
          ))}
        </View>
      )}
    />
  );
}

// Any emoji as a reaction, in a sheet over the lower part of the chat. Typing one from the phone's
// own emoji keyboard works too, for anything not listed.
export function EmojiPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (emoji: string) => void }) {
  const theme = useTheme();
  const styles = useStyles();
  const [typed, setTyped] = useState('');

  function pick(emoji: string) {
    setTyped('');
    rememberEmoji(emoji);
    onPick(emoji);
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} height={0.62}>
      {visible ? (
        <>
          <View style={styles.typedRow}>
            <TextInput
              value={typed}
              onChangeText={(text) => {
                setTyped(text);
                if (emojiOnlyCount(text) === 1) pick(text.trim());
              }}
              placeholder="Or type any emoji"
              placeholderTextColor={theme.textMuted}
              style={styles.typed}
              selectionColor={brand.accent}
              accessibilityLabel="Type an emoji"
            />
          </View>
          <EmojiGrid onPick={onPick} label="React" />
        </>
      ) : null}
    </BottomSheet>
  );
}

const useStyles = createThemedStyles((t) => ({
  typedRow: { paddingHorizontal: space.md, paddingBottom: space.sm },
  typed: {
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: t.surface,
    paddingHorizontal: space.lg,
    fontFamily: fonts.body,
    fontSize: 15,
    color: t.text,
  },
  list: { paddingHorizontal: space.sm, paddingBottom: space.lg, width: '100%', maxWidth: 640, alignSelf: 'center' },
  header: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.textMuted, paddingTop: space.md, paddingBottom: space.xs, paddingHorizontal: space.xs },
  row: { flexDirection: 'row' },
  cell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  pressed: { backgroundColor: t.surface },
  emoji: { fontSize: 28 },
}));
