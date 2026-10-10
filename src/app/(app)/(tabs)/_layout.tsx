import { router, useFocusEffect } from 'expo-router';
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { BookOpenIcon } from 'phosphor-react-native/src/icons/BookOpen';
import { CalendarBlankIcon } from 'phosphor-react-native/src/icons/CalendarBlank';
import { ChatsCircleIcon } from 'phosphor-react-native/src/icons/ChatsCircle';
import { HouseIcon } from 'phosphor-react-native/src/icons/House';
import { StorefrontIcon } from 'phosphor-react-native/src/icons/Storefront';
import { useCallback, useRef, useState } from 'react';
import { BackHandler, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UniEraMark } from '@/components/brand/uni-era-mark';
import { SearchField } from '@/components/search/search-field';
import { SearchPanel } from '@/components/search/search-panel';
import { TabButton } from '@/components/tabs/tab-button';
import { Avatar } from '@/components/ui/avatar';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { useHomeData } from '@/providers/home-provider';
import { brand, createThemedStyles, fonts, space, useTheme } from '@/theme/tokens';

// Persistent chrome for the signed-in app: the top bar (mark, search, avatar) and the bottom tab
// bar are drawn once here and never move. Each tab renders only its own content in the TabSlot.
// Searching lays the results over the tabs (which stay mounted underneath), so closing search
// returns to exactly where the student was.
export default function TabsLayout() {
  const theme = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { state } = useHomeData();
  const name = state.status === 'ready' ? state.home.full_name : null;

  const input = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const closeSearch = useCallback(() => {
    setQuery('');
    setSearching(false);
    input.current?.blur();
    Keyboard.dismiss();
  }, []);

  // Android back closes search first, while this screen is the one in front.
  useFocusEffect(
    useCallback(() => {
      if (!searching) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        closeSearch();
        return true;
      });
      return () => sub.remove();
    }, [searching, closeSearch]),
  );

  return (
    <Screen edges={['top']} style={styles.screen}>
      <View style={styles.topBar}>
        <UniEraMark size={30} color={theme.text} tasselColor={brand.red} />
        <SearchField
          ref={input}
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            if (text) setSearching(true);
          }}
          onFocus={() => setSearching(true)}
        />
        {searching ? (
          <Pressable
            onPress={closeSearch}
            accessibilityRole="button"
            accessibilityLabel="Close search"
            hitSlop={8}
            style={styles.cancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        ) : name ? (
          <PressableScale
            onPress={() => router.push('/profile')}
            accessibilityRole="button"
            accessibilityLabel="Your account"
            hitSlop={8}>
            <Avatar name={name} />
          </PressableScale>
        ) : (
          <View style={styles.avatarSpace} />
        )}
      </View>

      <View style={styles.body}>
        <Tabs style={styles.tabs}>
          <TabSlot style={styles.slot} />
          <TabList style={[styles.tabBar, { paddingBottom: insets.bottom }]}>
            <TabTrigger name="home" href="/" asChild>
              <TabButton label="Home" Icon={HouseIcon} />
            </TabTrigger>
            <TabTrigger name="chats" href="/chats" asChild>
              <TabButton label="Chats" Icon={ChatsCircleIcon} />
            </TabTrigger>
            <TabTrigger name="resources" href="/resources" asChild>
              <TabButton label="Resources" Icon={BookOpenIcon} />
            </TabTrigger>
            <TabTrigger name="events" href="/events" asChild>
              <TabButton label="Events" Icon={CalendarBlankIcon} />
            </TabTrigger>
            <TabTrigger name="shop" href="/shop" asChild>
              <TabButton label="Shop" Icon={StorefrontIcon} />
            </TabTrigger>
          </TabList>
        </Tabs>

        {searching ? (
          <View style={[styles.overlay, { paddingBottom: insets.bottom }]}>
            <SearchPanel
              query={query}
              onOpen={(person) => {
                Keyboard.dismiss();
                router.push({ pathname: '/people/[id]', params: { id: person.user_id } });
              }}
            />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.md,
    minHeight: 56,
  },
  cancel: { height: 40, justifyContent: 'center' },
  cancelText: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  avatarSpace: { width: 40, height: 40 },
  body: { flex: 1 },
  tabs: { flex: 1 },
  // TabSlot's container defaults to flexShrink 0, so a long screen grew past the window and
  // pushed the tab bar off the bottom. Let it fill only the space above the bar; screens scroll.
  slot: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: t.background,
    borderTopWidth: 1,
    borderTopColor: t.border,
    paddingHorizontal: space.sm,
  },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: t.background },
}));
