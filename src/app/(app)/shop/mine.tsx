import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';

import { ShopImage } from '@/components/shop/shop-image';
import { BackHeader } from '@/components/ui/back-header';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import {
  cardLine,
  linesLabel,
  loadMyListings,
  loadMyOrders,
  ORDER_STATUS,
  price,
  type ListingCard,
  type OrderWithListing,
} from '@/lib/shop';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Tab = 'orders' | 'listings';

// The student's own side of the shop: what they ordered (with where each order stands) and what
// they sell, including the merch their batch's reps run.
export default function MyShop() {
  const theme = useTheme();
  const styles = useStyles();
  // tab: which side to open on (the Shop tab's Your orders and Selling tiles).
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'listings' ? 'listings' : 'orders');
  const [orders, setOrders] = useState<OrderWithListing[] | null>(null);
  const [listings, setListings] = useState<ListingCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      Promise.all([loadMyOrders(), loadMyListings()]).then(([o, l]) => {
        if (!live) return;
        if (o.data) setOrders(o.data);
        if (l.data) setListings(l.data);
        setError(o.error ?? l.error);
        // Someone who sells but has never ordered starts on their listings.
        if (!params.tab && o.data?.length === 0 && (l.data?.length ?? 0) > 0) setTab((t) => (t === 'orders' ? 'listings' : t));
      });
      return () => {
        live = false;
      };
    }, [params.tab]),
  );

  const open = (id: string) => router.push({ pathname: '/shop/[id]', params: { id } });
  const loading = tab === 'orders' ? !orders : !listings;

  return (
    <Screen style={styles.screen}>
      <BackHeader title={tab === 'orders' ? 'Your orders' : 'Selling'} />
      <View style={styles.top}>
        <View style={styles.segments} accessibilityRole="tablist">
          {(
            [
              { key: 'orders', label: 'Your orders' },
              { key: 'listings', label: 'Selling' },
            ] as const
          ).map((s) => {
            const active = s.key === tab;
            return (
              <PressableScale
                key={s.key}
                onPress={() => setTab(s.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[styles.segment, active && styles.segmentActive]}>
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{s.label}</Text>
              </PressableScale>
            );
          })}
        </View>
        <FormMessage message={error} />
      </View>

      {loading ? (
        <ActivityIndicator color={theme.accentText} style={styles.loading} />
      ) : tab === 'orders' ? (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.content}
          data={orders}
          keyExtractor={(o) => o.id}
          renderItem={({ item }) => (
            <PressableScale onPress={() => open(item.listing.id)} accessibilityRole="button" scale={0.985} style={styles.row}>
              <ShopImage path={item.listing.photo} style={styles.thumb} />
              <View style={styles.copy}>
                <Text style={styles.title} numberOfLines={1}>
                  {item.listing.title}
                </Text>
                <Text style={styles.muted}>
                  {linesLabel(item.lines)} · {price(item.total)}
                </Text>
                <Text style={[styles.status, item.status === 'rejected' && styles.danger]} numberOfLines={2}>
                  {ORDER_STATUS[item.status]}
                  {item.status === 'rejected' && item.status_note ? `: ${item.status_note}` : ''}
                </Text>
              </View>
            </PressableScale>
          )}
          ItemSeparatorComponent={Separator}
          ListEmptyComponent={<Text style={styles.empty}>No orders yet. Merch you pre-order shows up here.</Text>}
        />
      ) : (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.content}
          data={listings}
          keyExtractor={(l) => l.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <PressableScale
                onPress={() => open(item.id)}
                accessibilityRole="button"
                accessibilityHint="Opens the listing"
                scale={0.985}
                style={styles.cardTop}>
                <ShopImage path={item.photo} style={styles.thumb} />
                <View style={styles.copy}>
                  <Text style={styles.title} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.muted}>
                    {price(item.price)} · {item.status === 'hidden' ? 'Hidden after reports' : cardLine(item)}
                  </Text>
                  {!item.mine ? <Text style={styles.muted}>Run by the reps of your batch</Text> : null}
                </View>
              </PressableScale>
              {item.kind === 'merch' ? (
                <PressableScale
                  onPress={() => router.push({ pathname: '/shop/orders/[id]', params: { id: item.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`View orders for ${item.title}: ${item.orders ?? 0} received${(item.to_check ?? 0) > 0 ? `, ${item.to_check} to check` : ''}`}
                  scale={0.985}
                  style={[styles.ordersButton, (item.to_check ?? 0) > 0 && styles.ordersButtonAlert]}>
                  <Text style={[styles.ordersText, (item.to_check ?? 0) > 0 && styles.ordersTextAlert]}>
                    {item.orders ?? 0} {item.orders === 1 ? 'order' : 'orders'} received
                    {(item.to_check ?? 0) > 0 ? ` · ${item.to_check} to check` : ''}
                  </Text>
                  <Text style={[styles.ordersOpen, (item.to_check ?? 0) > 0 && styles.ordersTextAlert]}>View orders</Text>
                </PressableScale>
              ) : null}
            </View>
          )}
          ItemSeparatorComponent={Separator}
          ListEmptyComponent={<Text style={styles.empty}>You are not selling anything. Use Sell something in the Shop.</Text>}
        />
      )}
    </Screen>
  );
}

function Separator() {
  const styles = useStyles();
  return <View style={styles.separator} />;
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  top: { paddingHorizontal: space.xl, gap: space.md, width: '100%', maxWidth: 600, alignSelf: 'center' },
  segments: { flexDirection: 'row', backgroundColor: t.surface, borderRadius: radius.pill, padding: 4 },
  segment: { flex: 1, minHeight: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: t.accent },
  segmentText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted },
  segmentTextActive: { color: t.onAccent },
  loading: { marginTop: space.xxl },
  list: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center' },
  content: { padding: space.xl, paddingBottom: space.xxxl },
  separator: { height: space.md },
  row: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.lg,
    padding: space.md,
  },
  card: { borderWidth: 1, borderColor: t.border, borderRadius: radius.lg, padding: space.md, gap: space.md },
  cardTop: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  ordersButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    backgroundColor: t.surface,
  },
  ordersButtonAlert: { backgroundColor: t.accent },
  ordersText: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 14, color: t.text },
  ordersOpen: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.accentText },
  ordersTextAlert: { color: t.onAccent },
  thumb: { width: 64, height: 64, borderRadius: radius.md },
  copy: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  muted: { fontFamily: fonts.body, fontSize: 14, color: t.textMuted },
  status: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: t.text },
  accent: { color: t.accentText },
  danger: { color: t.dangerText },
  empty: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: t.textMuted,
    textAlign: 'center',
    paddingVertical: space.xl,
  },
}));
