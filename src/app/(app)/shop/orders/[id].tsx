import { useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Share, Text, View } from 'react-native';
import { PhoneIcon } from 'phosphor-react-native/src/icons/Phone';

import { SearchInput } from '@/components/resources/search-input';
import { PhotoViewer, ShopImage } from '@/components/shop/shop-image';
import { ActionSheet, type SheetAction } from '@/components/ui/action-sheet';
import { BackHeader } from '@/components/ui/back-header';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { dayAndTime } from '@/lib/dates';
import {
  isPdf,
  linesLabel,
  loadListingOrders,
  openSlip,
  ORDER_STATUS,
  ordersCsv,
  price,
  setOrderStatus,
  type ListingOrders,
  type OrderStatus,
  type RepOrder,
} from '@/lib/shop';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type View_ = 'check' | 'all';

// The reps' order list for one piece of merch: how many of each size (for the supplier), the money
// confirmed, and every order with the buyer's name, batch, email, phone and slip. Slips are checked
// here: Confirm, or Reject with a reason the buyer sees; then Collected when it is handed over.
export default function OrdersScreen() {
  const theme = useTheme();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<ListingOrders | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View_>('check');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [slip, setSlip] = useState<{ path: string; title: string } | null>(null);
  const [menu, setMenu] = useState<RepOrder | null>(null);
  const [rejecting, setRejecting] = useState<RepOrder | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    let live = true;
    loadListingOrders(id).then((r) => {
      if (!live) return;
      if (r.data) {
        setData(r.data);
        if (r.data.totals.to_check === 0) setView('all');
      }
      setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [id]);

  const set = useCallback(async (order: RepOrder, status: OrderStatus, note?: string) => {
    setBusy(order.id);
    setError(null);
    const r = await setOrderStatus(order.id, status, note);
    setBusy(null);
    if (r.data) setData(r.data);
    setError(r.error);
    return !r.error;
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.orders ?? []).filter(
      (o) =>
        (view === 'all' || o.status === 'placed') &&
        (!q ||
          o.buyer.name.toLowerCase().includes(q) ||
          o.buyer.email.toLowerCase().includes(q) ||
          o.phone.includes(q.replace(/\s/g, ''))),
    );
  }, [data, view, query]);

  async function share() {
    if (!data) return;
    await Share.share({ title: `${data.listing.title} orders`, message: ordersCsv(data) }).catch(() => {});
  }

  if (!data) {
    return (
      <Screen style={styles.screen}>
        <BackHeader title="Orders" />
        <View style={styles.center}>
          {error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} />}
        </View>
      </Screen>
    );
  }

  const { totals } = data;
  const menuActions: SheetAction[] = menu
    ? [
        ...(menu.status !== 'placed' ? [{ label: 'Back to waiting', onPress: () => set(menu, 'placed') }] : []),
        ...(menu.status !== 'collected' ? [{ label: 'Mark collected', onPress: () => set(menu, 'collected') }] : []),
        ...(menu.status !== 'rejected'
          ? [
              {
                label: 'Reject',
                destructive: true,
                onPress: () => {
                  setReason('');
                  setRejecting(menu);
                },
              },
            ]
          : []),
        { label: `Call ${menu.phone}`, onPress: () => Linking.openURL(`tel:${menu.phone}`).catch(() => {}) },
      ]
    : [];

  const header = (
    <View style={styles.header}>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
          {data.listing.title}
        </Text>
        <Text style={styles.muted}>
          {totals.orders} {totals.orders === 1 ? 'order' : 'orders'} · {totals.quantity} items · {price(totals.paid)} confirmed of{' '}
          {price(totals.expected)}
        </Text>
      </View>

      {data.sizes.length > 0 ? (
        <View style={styles.sizes}>
          {data.sizes.map((s) => (
            <View key={s.size ?? 'one'} style={styles.size}>
              <Text style={styles.sizeName}>{s.size ?? 'Total'}</Text>
              <Text style={styles.sizeCount}>{s.quantity}</Text>
              <Text style={styles.sizePaid}>{s.paid ?? 0} paid</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Button label="Share the list (CSV)" variant="quiet" onPress={share} />

      <View style={styles.segments} accessibilityRole="tablist">
        {(
          [
            { key: 'check', label: `To check (${totals.to_check})` },
            { key: 'all', label: `All (${totals.orders})` },
          ] as const
        ).map((s) => {
          const active = s.key === view;
          return (
            <PressableScale
              key={s.key}
              onPress={() => setView(s.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.segment, active && styles.segmentActive]}>
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{s.label}</Text>
            </PressableScale>
          );
        })}
      </View>
      {totals.orders > 5 ? (
        <SearchInput value={query} onChangeText={setQuery} placeholder="Search by name, email or phone" />
      ) : null}
      <FormMessage message={error} />
    </View>
  );

  return (
    <Screen style={styles.screen}>
      <BackHeader title="Orders" />
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        data={shown}
        keyExtractor={(o) => o.id}
        extraData={busy}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <OrderRow
            order={item}
            busy={busy === item.id}
            onSlip={async (s) =>
              isPdf(s.path) ? setError(await openSlip({ path: s.path, name: `${s.title}.pdf` })) : setSlip(s)
            }
            onConfirm={() => set(item, 'paid')}
            onCollected={() => set(item, 'collected')}
            onMore={() => setMenu(item)}
          />
        )}
        ItemSeparatorComponent={Separator}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {view === 'check' ? 'No slips waiting. Everything is checked.' : query ? 'Nobody matches.' : 'No orders yet.'}
          </Text>
        }
        initialNumToRender={8}
        keyboardShouldPersistTaps="handled"
      />

      <PhotoViewer photo={slip ? { path: slip.path } : null} title={slip?.title} onClose={() => setSlip(null)} />
      <ActionSheet visible={!!menu} actions={menuActions} onClose={() => setMenu(null)} />
      <BottomSheet
        visible={!!rejecting}
        title={`Reject ${rejecting?.buyer.name.split(' ')[0] ?? ''}'s order`}
        onClose={() => setRejecting(null)}>
        <View style={styles.sheet}>
          <TextField
            label="Why? They see this"
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. The amount on the slip is Rs 1,500, not Rs 1,800"
            multiline
            maxLength={200}
            autoFocus
          />
          <Button
            label="Reject order"
            disabled={!reason.trim()}
            loading={!!rejecting && busy === rejecting.id}
            onPress={async () => {
              if (rejecting && (await set(rejecting, 'rejected', reason.trim()))) setRejecting(null);
            }}
          />
        </View>
      </BottomSheet>
    </Screen>
  );
}

function Separator() {
  const styles = useStyles();
  return <View style={styles.separator} />;
}

const OrderRow = memo(function OrderRow({
  order,
  busy,
  onSlip,
  onConfirm,
  onCollected,
  onMore,
}: {
  order: RepOrder;
  busy: boolean;
  onSlip: (s: { path: string; title: string }) => void;
  onConfirm: () => void;
  onCollected: () => void;
  onMore: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const done = order.status === 'paid' || order.status === 'collected';
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <View style={styles.flex}>
          <Text style={styles.name}>{order.buyer.name}</Text>
          <Text style={styles.muted} numberOfLines={1}>
            {order.buyer.batch ?? order.buyer.email}
          </Text>
        </View>
        <View style={[styles.pill, order.status === 'rejected' ? styles.pillDanger : done ? styles.pillDone : null]}>
          <Text
            style={[styles.pillText, order.status === 'rejected' ? styles.pillDangerText : done ? styles.pillDoneText : null]}>
            {order.status === 'placed' ? 'To check' : ORDER_STATUS[order.status]}
          </Text>
        </View>
      </View>

      <View style={styles.rowBody}>
        {order.slip_path ? (
          <PressableScale
            onPress={() => onSlip({ path: order.slip_path!, title: `${order.buyer.name}'s slip` })}
            accessibilityRole="imagebutton"
            accessibilityLabel={`${order.buyer.name}'s slip`}>
            <ShopImage path={order.slip_path} style={styles.slip} />
          </PressableScale>
        ) : null}
        <View style={styles.flex}>
          <Text style={styles.order}>
            {linesLabel(order.lines)} · {price(order.total)}
          </Text>
          <PressableScale
            onPress={() => Linking.openURL(`tel:${order.phone}`).catch(() => {})}
            accessibilityRole="button"
            style={styles.phone}>
            <PhoneIcon size={15} weight="bold" color={theme.accentText} />
            <Text style={styles.link}>{order.phone}</Text>
          </PressableScale>
          <Text style={styles.muted} numberOfLines={1} selectable>
            {order.buyer.email}
          </Text>
          {order.note ? <Text style={styles.note}>“{order.note}”</Text> : null}
          {order.status === 'rejected' && order.status_note ? <Text style={styles.danger}>{order.status_note}</Text> : null}
          <Text style={styles.time}>
            {dayAndTime(order.updated_at)}
            {order.checked_by && order.status !== 'placed' ? ` · ${order.checked_by}` : ''}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        {order.status === 'placed' ? (
          <PressableScale
            onPress={onConfirm}
            disabled={busy}
            accessibilityRole="button"
            style={[styles.action, styles.actionMain]}>
            {busy ? <ActivityIndicator color={theme.onAccent} /> : <Text style={styles.actionMainText}>Confirm payment</Text>}
          </PressableScale>
        ) : order.status === 'paid' ? (
          <PressableScale
            onPress={onCollected}
            disabled={busy}
            accessibilityRole="button"
            style={[styles.action, styles.actionMain]}>
            {busy ? <ActivityIndicator color={theme.onAccent} /> : <Text style={styles.actionMainText}>Mark collected</Text>}
          </PressableScale>
        ) : null}
        <PressableScale
          onPress={onMore}
          accessibilityRole="button"
          accessibilityLabel={`More for ${order.buyer.name}`}
          style={styles.action}>
          <Text style={styles.actionText}>{order.status === 'placed' ? 'Reject or more' : 'More'}</Text>
        </PressableScale>
      </View>
    </View>
  );
});

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  list: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center' },
  content: { padding: space.xl, paddingTop: space.sm, paddingBottom: space.xxxl },
  header: { gap: space.lg, marginBottom: space.lg },
  head: { gap: space.xs },
  flex: { flex: 1 },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: t.text },
  muted: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.textMuted },
  sizes: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  size: {
    minWidth: 72,
    alignItems: 'center',
    backgroundColor: t.surface,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  sizeName: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.textMuted },
  sizeCount: { fontFamily: fonts.bodyBold, fontSize: 22, color: t.text },
  sizePaid: { fontFamily: fonts.body, fontSize: 12, color: t.textMuted },
  segments: { flexDirection: 'row', backgroundColor: t.surface, borderRadius: radius.pill, padding: 4 },
  segment: { flex: 1, minHeight: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: t.accent },
  segmentText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted },
  segmentTextActive: { color: t.onAccent },
  empty: { fontFamily: fonts.body, fontSize: 15, color: t.textMuted, textAlign: 'center', paddingVertical: space.xl },
  separator: { height: space.md },
  row: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  rowBody: { flexDirection: 'row', gap: space.md },
  name: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  order: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  phone: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', minHeight: 30 },
  link: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.accentText },
  note: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.text, marginTop: 2 },
  danger: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 20, color: t.dangerText },
  time: { fontFamily: fonts.body, fontSize: 12, color: t.textMuted, marginTop: 2 },
  slip: { width: 64, height: 84, borderRadius: radius.sm },
  pill: { borderRadius: radius.pill, paddingHorizontal: space.sm + 2, paddingVertical: 3, backgroundColor: t.accentTint },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.onAccentTint },
  pillDone: { backgroundColor: t.accent },
  pillDoneText: { color: t.onAccent },
  pillDanger: { backgroundColor: t.errorBg },
  pillDangerText: { color: t.errorText },
  actions: { flexDirection: 'row', gap: space.sm },
  action: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.background,
  },
  actionMain: { backgroundColor: t.accent, borderColor: t.accent },
  actionMainText: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.onAccent },
  actionText: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  sheet: { gap: space.lg, padding: space.xl },
}));
