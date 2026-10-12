import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, Text, View } from 'react-native';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';

import { SearchInput } from '@/components/resources/search-input';
import { ChoiceChip } from '@/components/shop/choice-chip';
import { ListingCard } from '@/components/shop/listing-card';
import { ShopHub, type HubSummary } from '@/components/shop/shop-hub';
import { ActionSheet } from '@/components/ui/action-sheet';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import {
  cachedFeed,
  CATEGORIES,
  loadFeed,
  loadMyListings,
  loadMyOrders,
  type Category,
  type Feed,
  type ListingCard as Card,
  type ShopFilter,
  type ShopScope,
} from '@/lib/shop';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

const FILTERS: { key: ShopFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'merch', label: 'Merch' },
  { key: 'item', label: 'From students' },
];

const SCOPES: { key: ShopScope; label: string }[] = [
  { key: 'mine', label: 'Your uni' },
  { key: 'others', label: 'Other unis' },
];

// An odd last card would stretch across both columns; a spacer keeps it half width.
type Cell = Card | { id: string; spacer: true };
const pair = (list: Card[]): Cell[] => (list.length % 2 ? [...list, { id: 'spacer', spacer: true }] : list);

// The shop: merch to pre-order and things students sell, newest first, at your university or (Other
// unis) what other universities opened to everyone. Reps publish merch; anyone can sell an item.
// Nothing is paid through the app except what reps collect for merch, the same way as before (bank
// transfer and slip).
export default function Shop() {
  const theme = useTheme();
  const styles = useStyles();
  const [filter, setFilter] = useState<ShopFilter>('all');
  const [scope, setScope] = useState<ShopScope>('mine');
  const [category, setCategory] = useState<Category | null>(null);
  const [query, setQuery] = useState('');
  const [typed, setTyped] = useState('');
  const [feed, setFeed] = useState<Feed | null>(() => cachedFeed());
  const [error, setError] = useState<string | null>(null);
  const [end, setEnd] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hub, setHub] = useState<HubSummary | null>(null);
  const [choosing, setChoosing] = useState(false);
  const generation = useRef(0);

  // Searching waits until typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    const r = await loadFeed({ filter, scope, category, query });
    if (mine !== generation.current) return;
    if (r.data) {
      setFeed(r.data);
      setEnd(r.data.listings.length < 30);
    }
    setError(r.error);
  }, [filter, scope, category, query]);

  // The student's own orders and listings, for the hub (slips to check, orders that need a fix).
  const loadHub = useCallback(async () => {
    const [orders, listings] = await Promise.all([loadMyOrders(), loadMyListings()]);
    if (orders.data && listings.data) setHub({ orders: orders.data, listings: listings.data });
  }, []);

  // Again whenever the tab shows (after publishing, ordering or editing).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  useFocusEffect(
    useCallback(() => {
      loadHub();
    }, [loadHub]),
  );

  function sell() {
    if (feed?.can_post_merch) setChoosing(true);
    else router.push({ pathname: '/shop/new', params: { kind: 'item' } });
  }

  async function more() {
    const list = feed?.listings ?? [];
    if (end || loadingMore || list.length === 0) return;
    setLoadingMore(true);
    const mine = generation.current;
    const r = await loadFeed({ filter, scope, category, query, before: list[list.length - 1].created_at });
    setLoadingMore(false);
    if (mine !== generation.current || !r.data) return;
    const known = new Set(list.map((l) => l.id));
    setFeed({ ...r.data, listings: [...list, ...r.data.listings.filter((l) => !known.has(l.id))] });
    setEnd(r.data.listings.length < 30);
  }

  async function pull() {
    setRefreshing(true);
    await Promise.all([load(), loadHub()]);
    setRefreshing(false);
  }

  const listings = feed?.listings ?? [];

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Text style={styles.title} accessibilityRole="header">
          Shop
        </Text>
        <PressableScale
          onPress={sell}
          accessibilityRole="button"
          accessibilityLabel={feed?.can_post_merch ? 'Sell or publish merch' : 'Sell something'}
          hitSlop={6}
          style={styles.sell}>
          <PlusIcon size={18} weight="bold" color={theme.onAccent} />
          <Text style={styles.sellText}>Sell</Text>
        </PressableScale>
      </View>

      <ShopHub summary={hub} />

      <SearchInput value={typed} onChangeText={setTyped} placeholder="Search the shop" />

      <View style={styles.segments} accessibilityRole="tablist">
        {FILTERS.map((f) => {
          const active = f.key === filter;
          return (
            <PressableScale
              key={f.key}
              onPress={() => {
                setFilter(f.key);
                if (f.key !== 'item') setCategory(null);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.segment, active && styles.segmentActive]}>
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{f.label}</Text>
            </PressableScale>
          );
        })}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {SCOPES.map((s) => (
          <ChoiceChip key={s.key} label={s.label} active={scope === s.key} onPress={() => setScope(s.key)} />
        ))}
        {filter === 'item' ? <View style={styles.divider} /> : null}
        {filter === 'item'
          ? CATEGORIES.map((c) => (
              <ChoiceChip
                key={c.key}
                label={c.label}
                active={category === c.key}
                onPress={() => setCategory(category === c.key ? null : c.key)}
              />
            ))
          : null}
      </ScrollView>

      <FormMessage message={feed ? null : error} />
    </View>
  );

  const sheet = (
    <ActionSheet
      visible={choosing}
      onClose={() => setChoosing(false)}
      actions={[
        ...(feed?.is_rep
          ? [
              {
                label: 'Publish merch for your batch',
                onPress: () => router.push({ pathname: '/shop/new', params: { kind: 'merch', as: 'batch' } }),
              },
            ]
          : []),
        ...(feed?.merch_club
          ? [
              {
                label: `Publish merch for ${feed.merch_club}`,
                onPress: () =>
                  router.push({ pathname: '/shop/new', params: { kind: 'merch', as: 'club', club: feed.merch_club! } }),
              },
            ]
          : []),
        { label: 'Sell something you own', onPress: () => router.push({ pathname: '/shop/new', params: { kind: 'item' } }) },
        ...(feed?.is_rep
          ? [
              { label: 'Add a merch lead', onPress: () => router.push({ pathname: '/shop/leads', params: { add: '1' } }) },
              { label: 'See merch leads', onPress: () => router.push('/shop/leads') },
            ]
          : feed?.merch_club
            ? [{ label: 'Your merch lead role', onPress: () => router.push('/shop/leads') }]
            : []),
      ]}
    />
  );

  return (
    <>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        data={pair(listings)}
        keyExtractor={(l) => l.id}
        numColumns={2}
        columnWrapperStyle={styles.columns}
        renderItem={({ item }) => ('spacer' in item ? <View style={styles.spacer} /> : <ListingCard listing={item} />)}
        ListHeaderComponent={header}
        ListEmptyComponent={
          feed ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{query || category ? 'Nothing matches' : 'Nothing for sale yet'}</Text>
              <Text style={styles.emptyBody}>
                {query || category
                  ? 'Try another word or category.'
                  : scope === 'others'
                    ? 'Merch and things students at other universities open to everyone show up here.'
                    : 'Batch T-shirts from your reps and things students sell at your university show up here. Selling a calculator or a laptop? List it.'}
              </Text>
            </View>
          ) : !error ? (
            <ActivityIndicator color={theme.accentText} style={styles.loading} />
          ) : null
        }
        ListFooterComponent={
          listings.length > 0 ? (
            <View style={styles.footer}>
              {loadingMore ? <ActivityIndicator color={theme.accentText} /> : null}
              {end ? (
                <Text style={styles.safety}>
                  Buying from a student? Meet on campus, check it works, and pay when you collect. Never pay in advance.
                </Text>
              ) : null}
            </View>
          ) : null
        }
        onEndReached={more}
        onEndReachedThreshold={0.6}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={pull}
            tintColor={theme.accentText}
            colors={[theme.accentText]}
            progressBackgroundColor={theme.surface}
          />
        }
      />
      {sheet}
    </>
  );
}

const useStyles = createThemedStyles((t) => ({
  list: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center' },
  content: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.xxxl },
  header: { gap: space.lg, marginBottom: space.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  title: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, color: t.text, letterSpacing: -0.3 },
  sell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    backgroundColor: t.accent,
    borderRadius: radius.pill,
    paddingLeft: space.md,
    paddingRight: space.lg,
    minHeight: 44,
  },
  sellText: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.onAccent },
  segments: { flexDirection: 'row', backgroundColor: t.surface, borderRadius: radius.pill, padding: 4 },
  segment: { flex: 1, minHeight: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: t.accent },
  segmentText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted },
  segmentTextActive: { color: t.onAccent },
  chips: { gap: space.sm, paddingRight: space.xl, alignItems: 'center' },
  divider: { width: 1, height: 24, backgroundColor: t.border, marginHorizontal: space.xs },
  columns: { gap: space.md, marginBottom: space.md },
  spacer: { flex: 1 },
  loading: { marginTop: space.xxl },
  empty: {
    borderWidth: 1,
    borderColor: t.border,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    padding: space.xl,
    gap: space.xs,
  },
  emptyTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  emptyBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: t.textMuted },
  footer: { gap: space.md, alignItems: 'center', paddingTop: space.md },
  safety: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: t.textMuted, textAlign: 'center' },
}));
