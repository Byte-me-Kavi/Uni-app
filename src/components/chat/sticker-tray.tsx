import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View, useWindowDimensions } from 'react-native';
import { BackspaceIcon } from 'phosphor-react-native/src/icons/Backspace';
import { ClockIcon } from 'phosphor-react-native/src/icons/Clock';
import { ImageIcon } from 'phosphor-react-native/src/icons/Image';
import { SmileyIcon } from 'phosphor-react-native/src/icons/Smiley';
import { StarIcon } from 'phosphor-react-native/src/icons/Star';
import { StickerIcon } from 'phosphor-react-native/src/icons/Sticker';

import { EmojiGrid } from '@/components/chat/emoji-picker';
import { ActionSheet } from '@/components/ui/action-sheet';
import { PressableScale } from '@/components/ui/pressable-scale';
import { readCache, writeCache } from '@/lib/cache';
import {
  canImportWhatsApp,
  cancelImport,
  importFromWhatsApp,
  linkWhatsApp,
  makeStickerFromPhoto,
  removeMine,
  setFavourite,
  useStickerLibrary,
  type LibrarySticker,
} from '@/lib/chat/sticker-library';
import { stickerSource } from '@/lib/chat/stickers';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

const HEIGHT = 300;
const MODE_KEY = 'tray:mode';
type Mode = 'emoji' | 'stickers';
type Tab = 'recent' | 'favourites' | 'mine';

const parse = (sticker: string) => {
  const [pack, id] = sticker.split(':');
  return { pack, id };
};
// The built-in emoji-style pack is no longer offered (plain emoji replaced it); messages already
// sent with it still show.
const offered = (sticker: string) => !sticker.startsWith('fluent:');

type Props = {
  onPick: (sticker: { pack: string; id: string }) => void;
  /** An emoji tapped: goes into the message, as typed text. */
  onEmoji: (emoji: string) => void;
  onBackspace: () => void;
};

// In the keyboard's place under the message box, as in WhatsApp: Emoji (normal Unicode emoji,
// typed into the message) and Stickers (Recent, Favourites, and your own from WhatsApp or photos).
// It reopens on whichever you used last.
export function StickerTray({ onPick, onEmoji, onBackspace }: Props) {
  const theme = useTheme();
  const styles = useStyles();
  const [mode, setMode] = useState<Mode>(() => readCache<Mode>(MODE_KEY) ?? 'emoji');

  function choose(next: Mode) {
    setMode(next);
    writeCache(MODE_KEY, next);
  }

  return (
    <View style={styles.tray}>
      <View style={styles.modes} accessibilityRole="tablist">
        {(
          [
            { key: 'emoji', label: 'Emoji', Icon: SmileyIcon },
            { key: 'stickers', label: 'Stickers', Icon: StickerIcon },
          ] as const
        ).map(({ key, label, Icon }) => (
          <PressableScale
            key={key}
            onPress={() => choose(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === key }}
            style={[styles.mode, mode === key && styles.modeActive]}>
            <Icon size={18} color={mode === key ? theme.background : theme.text} weight="bold" />
            <Text style={[styles.modeText, mode === key && styles.modeTextActive]}>{label}</Text>
          </PressableScale>
        ))}
        <View style={styles.flex} />
        {mode === 'emoji' ? (
          <PressableScale
            onPress={onBackspace}
            accessibilityRole="button"
            accessibilityLabel="Delete"
            hitSlop={8}
            style={styles.backspace}>
            <BackspaceIcon size={22} color={theme.text} weight="bold" />
          </PressableScale>
        ) : null}
      </View>
      {mode === 'emoji' ? <EmojiGrid onPick={onEmoji} label="Add" /> : <Stickers onPick={onPick} />}
    </View>
  );
}

function Stickers({ onPick }: { onPick: Props['onPick'] }) {
  const theme = useTheme();
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const items = useStickerLibrary((s) => s.items);
  const importing = useStickerLibrary((s) => s.importing);
  const linked = useStickerLibrary((s) => s.whatsappLinked);
  const remaining = useStickerLibrary((s) => s.remaining);
  const [tab, setTab] = useState<Tab | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [making, setMaking] = useState(false);

  // New WhatsApp stickers come in whenever the stickers open (at most once a day).
  useEffect(() => {
    importFromWhatsApp().then((message) => message && setNote(message));
  }, []);

  const usable = items.filter((s) => offered(s.sticker));
  const recent = usable
    .filter((s) => s.used_at)
    .sort((a, b) => ((a.used_at ?? '') < (b.used_at ?? '') ? 1 : -1))
    .slice(0, 32);
  const mine = usable.filter((s) => s.mine);
  const shown: Tab = tab ?? (recent.length ? 'recent' : 'mine');
  const list: string[] = (shown === 'recent' ? recent : shown === 'favourites' ? usable.filter((s) => s.favourite) : mine).map(
    (s) => s.sticker,
  );

  const columns = Math.max(4, Math.min(8, Math.floor(Math.min(width, 640) / 88)));
  const size = Math.floor((Math.min(width, 640) - space.md * 2) / columns);
  const entry = (sticker: string): LibrarySticker | undefined => items.find((s) => s.sticker === sticker);
  const offerWhatsApp = canImportWhatsApp && !linked;

  // Your stickers tab opens as soon as Android gives access, so the stickers can be seen arriving.
  async function link() {
    setNote(null);
    const message = await linkWhatsApp(() => setTab('mine'));
    if (message) setNote(message);
  }

  async function checkWhatsApp() {
    setNote(null);
    setTab('mine');
    const message = await importFromWhatsApp(true);
    if (message) setNote(message);
  }

  async function make() {
    setNote(null);
    setMaking(true);
    const made = await makeStickerFromPhoto().catch(() => ({ error: 'Could not make that sticker.' }));
    setMaking(false);
    if (made && 'error' in made) setNote(made.error);
    else if (made) setTab('mine');
  }

  const tabs: { key: Tab; label: string; Icon: typeof ClockIcon }[] = [
    { key: 'recent', label: 'Recent', Icon: ClockIcon },
    { key: 'favourites', label: 'Favourites', Icon: StarIcon },
    { key: 'mine', label: 'My stickers', Icon: StickerIcon },
  ];

  return (
    <View style={styles.flex}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {tabs.map(({ key, label, Icon }) => (
          <PressableScale
            key={key}
            onPress={() => setTab(key)}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: shown === key }}
            style={[styles.tab, shown === key && styles.tabActive]}>
            <Icon size={20} color={shown === key ? theme.text : theme.textMuted} weight={shown === key ? 'fill' : 'bold'} />
          </PressableScale>
        ))}
        <PressableScale
          onPress={make}
          disabled={making}
          accessibilityRole="button"
          accessibilityLabel="Make a sticker from a photo"
          style={styles.tab}>
          {making ? <ActivityIndicator color={theme.text} /> : <ImageIcon size={20} color={theme.textMuted} weight="bold" />}
        </PressableScale>
      </View>

      {/* Android lets an app read WhatsApp's sticker folder only once you allow it, one time. The
          folder opens already selected, so it is two taps; after that every new sticker you get in
          WhatsApp arrives here on its own. */}
      {offerWhatsApp ? (
        <View style={styles.card}>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>Bring your WhatsApp stickers</Text>
            <Text style={styles.cardBody}>
              Android asks once: tap “Use this folder”, then “Allow”. New ones come in by themselves after that.
            </Text>
          </View>
          <PressableScale onPress={link} accessibilityRole="button" style={styles.cardButton}>
            <Text style={styles.cardButtonText}>Bring in</Text>
          </PressableScale>
        </View>
      ) : null}
      {importing ? (
        <View style={styles.progress} accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.text} size="small" />
          <Text style={styles.progressText}>
            {importing.total
              ? `Bringing in WhatsApp stickers: ${importing.done.toLocaleString()} of ${importing.total.toLocaleString()}`
              : 'Looking for your WhatsApp stickers…'}
          </Text>
          <PressableScale onPress={cancelImport} accessibilityRole="button" accessibilityLabel="Stop bringing in stickers" hitSlop={8} style={styles.cancel}>
            <Text style={styles.cancelText}>Stop</Text>
          </PressableScale>
        </View>
      ) : note ? (
        <Text style={styles.note} accessibilityLiveRegion="polite">
          {note}
        </Text>
      ) : null}
      {!importing && canImportWhatsApp && linked && remaining > 0 ? (
        <View style={styles.card}>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>
              {remaining.toLocaleString()} more {remaining === 1 ? 'sticker' : 'stickers'} in WhatsApp
            </Text>
            <Text style={styles.cardBody}>Newest first. You can stop at any time.</Text>
          </View>
          <PressableScale onPress={checkWhatsApp} accessibilityRole="button" style={styles.cardButton}>
            <Text style={styles.cardButtonText}>Bring in the rest</Text>
          </PressableScale>
        </View>
      ) : !importing && !note && canImportWhatsApp && linked && shown === 'mine' ? (
        <PressableScale onPress={checkWhatsApp} accessibilityRole="button" style={styles.check}>
          <Text style={styles.checkText}>Check WhatsApp for new stickers</Text>
        </PressableScale>
      ) : null}

      <FlatList
        key={`${shown}-${columns}`}
        data={list}
        numColumns={columns}
        keyExtractor={(s) => s}
        contentContainerStyle={styles.grid}
        initialNumToRender={columns * 3}
        renderItem={({ item }) => {
          const source = stickerSource(parse(item));
          return (
            <PressableScale
              onPress={() => onPick(parse(item))}
              onLongPress={() => setMenu(item)}
              accessibilityRole="button"
              accessibilityLabel={`Send sticker${entry(item)?.favourite ? ', favourite' : ''}`}
              accessibilityHint="Long press to add to favourites"
              style={{ width: size, height: size, padding: space.sm }}>
              {source ? <Image source={source} style={styles.sticker} contentFit="contain" autoplay={false} /> : null}
            </PressableScale>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {shown === 'recent'
              ? 'Stickers you send show here.'
              : shown === 'favourites'
                ? 'Long press any sticker, here or in a chat, to add it to favourites.'
                : offerWhatsApp
                  ? 'Your WhatsApp stickers show here once you bring them in. You can also make one from a photo.'
                  : canImportWhatsApp
                    ? 'No stickers yet. New stickers you get in WhatsApp come in here automatically.'
                    : 'Make your own from any photo with the photo button above.'}
          </Text>
        }
      />

      <ActionSheet
        visible={!!menu}
        onClose={() => setMenu(null)}
        actions={
          menu
            ? [
                entry(menu)?.favourite
                  ? { label: 'Remove from favourites', onPress: () => setFavourite(menu, false) }
                  : { label: 'Add to favourites', onPress: () => setFavourite(menu, true) },
                ...(entry(menu)?.mine ? [{ label: 'Remove from my stickers', destructive: true, onPress: () => removeMine(menu) }] : []),
              ]
            : []
        }
      />
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  tray: { height: HEIGHT, backgroundColor: t.surface },
  flex: { flex: 1 },
  modes: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.xs },
  mode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: t.background,
  },
  modeActive: { backgroundColor: t.focus },
  modeText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  modeTextActive: { color: t.background },
  backspace: { width: 44, height: 34, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', paddingHorizontal: space.sm, borderBottomWidth: 1, borderBottomColor: t.border },
  tab: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: t.tickRead },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: space.md,
    marginTop: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: t.background,
  },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: t.text },
  cardBody: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: t.textMuted },
  // The accent marks the thing to do; what sits on it is Ink.
  cardButton: { height: 36, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: brand.accent, justifyContent: 'center' },
  cardButtonText: { fontFamily: fonts.bodyBold, fontSize: 14, color: brand.ink },
  note: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: t.textMuted, paddingHorizontal: space.md, paddingTop: space.sm },
  progress: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingTop: space.sm },
  progressText: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: t.text },
  cancel: { paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.pill, backgroundColor: t.background },
  cancelText: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: t.text },
  check: { alignSelf: 'flex-start', marginHorizontal: space.md, marginTop: space.sm, paddingVertical: space.xs },
  checkText: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: t.tickRead },
  grid: { padding: space.md, alignSelf: 'center' },
  sticker: { width: '100%', height: '100%' },
  empty: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.textMuted, textAlign: 'center', padding: space.xl },
}));
