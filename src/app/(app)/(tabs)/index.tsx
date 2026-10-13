import { FlashList, type FlashListRef, type ViewToken } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { ImageIcon } from 'phosphor-react-native/src/icons/Image';
import { ArrowUpIcon } from 'phosphor-react-native/src/icons/ArrowUp';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';

import { FeedAd, FilesShared, KuppiSoon, ShopRow } from '@/components/feed/feed-extras';
import { FeedSkeleton } from '@/components/feed/feed-skeleton';
import { PostCard } from '@/components/feed/post-card';
import { lookOf } from '@/components/feed/post-look';
import { useFeed, type FeedItem } from '@/components/feed/use-feed';
import { HomeCarousel } from '@/components/home/home-carousel';
import { ExamStrip } from '@/components/resources/exam-strip';
import { HomeSkeleton } from '@/components/home/home-skeleton';
import { NoticeBanner } from '@/components/home/notice-banner';
import { PolicyCard } from '@/components/home/policy-card';
import { FresherCard } from '@/components/freshers/fresher-card';
import { QuietFeed } from '@/components/home/quiet-feed';
import { SetupList, type SetupStep } from '@/components/home/setup-list';
import { StaffCard } from '@/components/home/staff-card';
import { EntranceContext, Reveal } from '@/components/motion/reveal';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { adSeen } from '@/lib/ads';
import { useFeature } from '@/lib/app-config';
import { markSeen, type PostTag } from '@/lib/feed';
import { useModulesSnapshot } from '@/lib/modules';
import { firstName, type MyHome } from '@/lib/use-home';
import { useHomeData } from '@/providers/home-provider';
import { useIsFresher } from '@/providers/session-provider';
import { useScheme } from '@/theme/appearance';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// The home entrance (content rising in, the cap dropping onto the u in the brand card) plays once
// per launch. Coming back to Home later shows it instantly.
let homeIntroPlayed = false;

// A post counts as seen once half of it has been on screen for a second.
const VIEWABILITY = { itemVisiblePercentThreshold: 50, minimumViewTime: 1000 };

// Home tab: the greeting, brand card and set-up on top, then the feed, in one list that only draws
// what is on screen. The top bar and tab bar live in (tabs)/_layout.tsx.
export default function Home() {
  const theme = useTheme();
  const styles = useStyles();
  const { state, refreshing, refresh, retry } = useHomeData();
  const active = state.status === 'ready' && state.home.account_status === 'active';
  const feed = useFeed(active);
  // Posting paused by the Uni Era team: no Post button (the server refuses new posts anyway).
  const posting = useFeature('posting');
  // Freshers read and like; posting opens with their university email.
  const fresher = useIsFresher();
  const [visibleAds, setVisibleAds] = useState<string[]>([]);
  const list = useRef<FlashListRef<FeedItem>>(null);
  const [entrance] = useState(() => {
    const play = !homeIntroPlayed;
    homeIntroPlayed = true;
    return play;
  });

  // Counts posts and ads that have been on screen. FlashList keeps the first callback it gets.
  const [onViewable] = useState(() => ({ viewableItems }: { viewableItems: ViewToken<FeedItem>[] }) => {
    const ads: string[] = [];
    for (const v of viewableItems) {
      const item = v.item;
      if (!item) continue;
      if (item.type === 'post') markSeen(item.id);
      if (item.type === 'ad') {
        adSeen(item.ad.id, 'feed');
        ads.push(item.ad.id);
      }
    }
    setVisibleAds((old) => (old.join() === ads.join() ? old : ads));
  });

  const onRefresh = useCallback(() => {
    refresh();
    feed.refresh();
  }, [refresh, feed]);

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => (
      <View style={styles.item}>
        {item.type === 'post' ? (
          <PostCard id={item.id} />
        ) : item.type === 'ad' ? (
          <FeedAd ad={item.ad} active={visibleAds.includes(item.ad.id)} />
        ) : item.type === 'shop' ? (
          <ShopRow listings={item.listings} />
        ) : item.type === 'kuppi' ? (
          <KuppiSoon kuppi={item.kuppi} />
        ) : (
          <FilesShared files={item.files} />
        )}
      </View>
    ),
    [styles.item, visibleAds],
  );

  const header = (
    <View style={styles.header}>
      {state.status === 'loading' ? <HomeSkeleton /> : null}
      {state.status === 'error' ? (
        <View style={styles.error}>
          <FormMessage message="Could not load your home. Check your connection and try again." />
          <Button label="Try again" variant="quiet" onPress={retry} />
        </View>
      ) : null}
      {state.status === 'ready' ? <HomeContent home={state.home} entrance={entrance} /> : null}
      {state.status === 'ready' && !active ? <QuietFeed waiting={state.home.account_status === 'pending'} /> : null}
      {active ? <FeedHeader home={state.home} tag={feed.tag} onFilter={feed.filter} canPost={posting && !fresher} /> : null}
      {active && feed.status === 'switching' ? <FeedSkeleton /> : null}
    </View>
  );

  return (
    <EntranceContext value={entrance}>
      <View style={styles.scroll}>
        <FlashList
          ref={list}
          style={styles.scroll}
          onScroll={(e) => feed.onScrollY(e.nativeEvent.contentOffset.y)}
          scrollEventThrottle={250}
          contentContainerStyle={styles.content}
          data={active ? feed.items : []}
          keyExtractor={(item) => item.key}
          getItemType={(item) => (item.type === 'post' ? 'post' : item.type)}
          renderItem={renderItem}
          extraData={visibleAds}
          ListHeaderComponent={header}
          ListEmptyComponent={
            active && feed.loaded && feed.status !== 'refreshing' ? (
              <View style={styles.item}>
                <QuietFeed heading={false} tag={feed.tag} canPost={posting && !fresher} onShowAll={() => feed.filter(null)} />
              </View>
            ) : null
          }
          ListFooterComponent={
            active ? (
              <FeedFooter status={feed.status} end={feed.end} count={feed.items.length} onRetry={() => feed.refresh()} />
            ) : null
          }
          onEndReached={feed.more}
          onEndReachedThreshold={1.5}
          viewabilityConfig={VIEWABILITY}
          onViewableItemsChanged={onViewable}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing || feed.status === 'refreshing'}
              onRefresh={onRefresh}
              tintColor={theme.accentText}
              colors={[theme.accentText]}
              progressBackgroundColor={theme.surface}
            />
          }
        />
        {active && feed.hasNew ? (
          <PressableScale
            onPress={() => {
              feed.showWaiting();
              list.current?.scrollToOffset({ offset: 0, animated: true });
            }}
            accessibilityRole="button"
            accessibilityLabel="Show new posts"
            style={[styles.newPill, { backgroundColor: theme.accent }]}>
            <ArrowUpIcon size={16} weight="bold" color={theme.onAccent} />
            <Text style={[styles.newPillText, { color: theme.onAccent }]}>New posts</Text>
          </PressableScale>
        ) : null}
        {active && posting && !fresher ? (
          <PressableScale
            onPress={() =>
              router.push(
                feed.tag === 'bodim' || feed.tag === 'job' ? { pathname: '/post/new', params: { type: feed.tag } } : '/post/new',
              )
            }
            accessibilityRole="button"
            accessibilityLabel="New post"
            style={[styles.fab, { backgroundColor: theme.accent }]}>
            <PlusIcon size={17} weight="bold" color={theme.onAccent} />
            <Text style={[styles.fabText, { color: theme.onAccent }]}>Post</Text>
          </PressableScale>
        ) : null}
      </View>
    </EntranceContext>
  );
}

function HomeContent({ home, entrance }: { home: MyHome; entrance: boolean }) {
  const styles = useStyles();
  const fresher = useIsFresher();
  // Modules set up since Home last loaded count straight away.
  const modules = useModulesSnapshot();
  const hasModules = home.module_count > 0 || (!!modules?.batch && modules.current.length > 0);

  // Real account state only. Steps that are not built yet say so instead of linking nowhere.
  const steps: SetupStep[] = [
    fresher
      ? {
          key: 'email',
          label: 'Add your university email',
          done: false,
          onPress: () => router.push('/university-email'),
        }
      : { key: 'email', label: 'Confirm your university email', done: true },
    {
      key: 'approved',
      label: 'Get approved by the Uni Era team',
      done: home.account_status === 'active',
    },
    {
      key: 'batch',
      label: home.batch ? 'Joined your batch' : 'Join your batch group',
      done: home.has_cohort,
      detail: home.batch?.name,
      onPress: () => router.push('/batch'),
    },
    {
      key: 'modules',
      label: hasModules ? 'Set up your modules' : 'Set up your modules for this semester',
      done: hasModules,
      onPress: home.has_cohort ? () => router.push('/resources') : undefined,
    },
  ];

  return (
    <View style={styles.stack}>
      <Reveal order={0}>
        <Text style={styles.greeting} accessibilityRole="header">
          Hi, {firstName(home.full_name)}
        </Text>
        <Text style={styles.institution}>{home.institution.name}</Text>
      </Reveal>

      <NoticeBanner />

      <PolicyCard />

      {fresher ? <FresherCard /> : null}

      <Reveal order={1}>
        <HomeCarousel assemble={entrance} />
      </Reveal>

      {home.staff_role && home.pending_accounts !== null ? (
        <Reveal order={2}>
          <StaffCard count={home.pending_accounts} role={home.staff_role} />
        </Reveal>
      ) : null}

      {home.has_cohort ? (
        <Reveal order={3}>
          <ExamStrip limit={2} />
        </Reveal>
      ) : null}

      {/* Gone once every step is done. */}
      {steps.some((s) => !s.done) ? (
        <Reveal order={3}>
          <SetupList steps={steps} />
        </Reveal>
      ) : null}
    </View>
  );
}

const FILTERS: { tag: PostTag | null; label: string }[] = [
  { tag: null, label: 'All' },
  { tag: 'question', label: 'Questions' },
  { tag: 'lost_found', label: 'Lost & found' },
  { tag: 'bodim', label: 'Bodim' },
  { tag: 'job', label: 'Jobs' },
  { tag: 'notice', label: 'Notices' },
];

// "Your feed", the way in to posting (your photo and a prompt that opens the composer, with a photo
// button straight onto the picker), and the filters, each in its kind's colour.
function FeedHeader({
  home,
  tag,
  onFilter,
  canPost,
}: {
  home: MyHome;
  tag: PostTag | null;
  onFilter: (tag: PostTag | null) => void;
  canPost: boolean;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const styles = useStyles();
  const bodim = tag === 'bodim';
  const job = tag === 'job';
  return (
    <View style={styles.feedHead}>
      <Text style={styles.heading} accessibilityRole="header">
        Your feed
      </Text>
      {canPost ? (
        <View style={styles.prompt}>
          <PressableScale
            onPress={() =>
              router.push(bodim || job ? { pathname: '/post/new', params: { type: bodim ? 'bodim' : 'job' } } : '/post/new')
            }
            accessibilityRole="button"
            accessibilityLabel={bodim ? 'List your bodim' : job ? 'Post a job' : 'Write a post'}
            scale={0.99}
            style={styles.promptMain}>
            <Avatar name={home.full_name} path={home.avatar_path} size={36} />
            <Text style={styles.promptText} numberOfLines={1}>
              {bodim
                ? 'Have a room to rent? List your bodim'
                : job
                  ? 'Hiring students? Post a part-time job'
                  : tag === 'question'
                    ? 'Ask your uni something…'
                    : 'Ask, share or tell your uni…'}
            </Text>
          </PressableScale>
          <PressableScale
            onPress={() => router.push({ pathname: '/post/new', params: { photos: '1' } })}
            accessibilityRole="button"
            accessibilityLabel="Post photos"
            hitSlop={6}
            style={styles.promptPhoto}>
            <ImageIcon size={22} color={theme.accentText} />
          </PressableScale>
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {FILTERS.map((f) => {
          const look = f.tag ? lookOf({ tag: f.tag, details: null, notice_from: null }, theme, scheme) : null;
          const on = tag === f.tag;
          const solid = look?.solid ?? theme.text;
          const tint = look?.tint ?? theme.surface;
          const ink = on ? (look?.onSolid ?? theme.background) : (look?.text ?? theme.text);
          return (
            <PressableScale
              key={f.label}
              onPress={() => onFilter(f.tag)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Show ${f.label.toLowerCase()}`}
              style={[
                styles.filter,
                {
                  backgroundColor: on ? solid : tint,
                  borderColor: on ? solid : tint,
                },
              ]}>
              {look ? <look.Icon size={15} weight="bold" color={ink} /> : null}
              <Text style={[styles.filterText, { color: ink }]}>{f.label}</Text>
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );
}

function FeedFooter({ status, end, count, onRetry }: { status: string; end: boolean; count: number; onRetry: () => void }) {
  const theme = useTheme();
  const styles = useStyles();
  if (status === 'more') return <ActivityIndicator style={styles.footer} color={theme.accentText} />;
  if (status === 'error') {
    return (
      <View style={[styles.item, styles.footer]}>
        <FormMessage message="Could not load the feed. Check your connection." />
        <Button label="Try again" variant="quiet" onPress={onRetry} />
      </View>
    );
  }
  if (end && count > 3)
    return <Text style={[styles.footer, styles.caughtUp]}>{"You're all caught up. Pull down for new posts."}</Text>;
  return <View style={styles.footer} />;
}

const useStyles = createThemedStyles((t) => ({
  scroll: { flex: 1 },
  // New post: bottom right, above the tab bar, always in reach of the thumb.
  fab: {
    position: 'absolute',
    right: space.xl,
    bottom: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: space.md + 2,
    borderRadius: radius.pill,
    // Tinted by the text colour, not pure black, so it sits softly in light and dark.
    shadowColor: t.text,
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  fabText: { fontFamily: fonts.bodyBold, fontSize: 15 },
  content: { paddingTop: space.sm, paddingBottom: space.xxxl + 56 },
  header: {
    paddingHorizontal: space.xl,
    gap: space.xl,
    width: '100%',
    maxWidth: 608,
    alignSelf: 'center',
    paddingBottom: space.md,
  },
  item: {
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
    width: '100%',
    maxWidth: 608,
    alignSelf: 'center',
  },
  stack: { gap: space.xl },
  greeting: {
    fontFamily: fonts.display,
    fontSize: 32,
    lineHeight: 38,
    color: t.text,
    letterSpacing: -0.3,
  },
  institution: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    lineHeight: 21,
    color: t.textMuted,
    marginTop: 2,
  },
  error: { gap: space.lg },
  feedHead: { gap: space.md },
  heading: { fontFamily: fonts.display, fontSize: 21, color: t.text },
  prompt: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.lg,
    paddingLeft: space.sm,
  },
  promptMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
  },
  promptText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: t.textMuted,
  },
  promptPhoto: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { paddingVertical: space.xl, gap: space.md },
  switching: { paddingVertical: space.xl },
  filters: { gap: space.sm, paddingRight: space.xl },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: space.md + 2,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  filterText: { fontFamily: fonts.bodyBold, fontSize: 14 },
  // Above the list, centred: tapping it shows the newer feed and goes back to the top.
  newPill: {
    position: 'absolute',
    top: space.md,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    shadowColor: t.text,
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  newPillText: { fontFamily: fonts.bodyBold, fontSize: 14 },
  caughtUp: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: t.textMuted,
    textAlign: 'center',
    paddingHorizontal: space.xl,
  },
}));
