import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, ScrollView, Text, View, type ViewToken } from 'react-native';
import { CopyIcon } from 'phosphor-react-native/src/icons/Copy';
import { PhoneIcon } from 'phosphor-react-native/src/icons/Phone';
import { RulerIcon } from 'phosphor-react-native/src/icons/Ruler';
import { ShieldCheckIcon } from 'phosphor-react-native/src/icons/ShieldCheck';

import { ReportSheet, type ReportTarget } from '@/components/chat/report-sheet';
import { PhotoViewer, ShopImage } from '@/components/shop/shop-image';
import { ActionSheet, type SheetAction } from '@/components/ui/action-sheet';
import { Avatar } from '@/components/ui/avatar';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { startDirect } from '@/lib/chat/engine';
import { openChat } from '@/lib/chat/open-chat';
import { dayMonth } from '@/lib/dates';
import {
  cancelOrder,
  CATEGORIES,
  closesLabel,
  conditionLabel,
  copyText,
  isPdf,
  linesLabel,
  listingInterest,
  loadListing,
  openSlip,
  ORDER_STATUS,
  price,
  setListingStatus,
  type Listing,
} from '@/lib/shop';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// One listing. Merch: photos, sizes and size chart, when orders close, how to pay and collect, and
// the student's own order (or Pre-order). Reps see how many have ordered and manage it. Items: the
// seller, I'm interested (the seller is told), Message and Call, and how to buy safely; the seller
// sees who is interested and can message them.
export default function ListingScreen() {
  const theme = useTheme();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [width, setWidth] = useState(0);
  const [viewing, setViewing] = useState<{ path: string; title: string } | null>(null);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: SheetAction } | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    const r = await loadListing(id);
    if (r.data) setListing(r.data);
    setError(r.error);
  }, [id]);

  // Again when coming back from ordering, editing or the orders list.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onPage = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems[0]?.index != null) setPage(viewableItems[0].index);
  }, []);

  async function change(call: () => Promise<{ data: Listing | null; error: string | null }>, done?: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    const r = await call();
    setBusy(false);
    if (r.data) {
      setListing(r.data);
      if (done) setNote(done);
    }
    setError(r.error);
  }

  async function message(person: { id: string; name: string; avatar_path: string | null }) {
    setBusy(true);
    const r = await startDirect({ user_id: person.id, full_name: person.name, avatar_path: person.avatar_path });
    setBusy(false);
    if ('error' in r) return setError(r.error ?? 'Could not open a chat.');
    openChat(r.conversationId);
  }

  async function copy(text: string, what: string) {
    setNote((await copyText(text)) ? `${what} copied.` : null);
  }

  if (!listing) {
    return (
      <Screen style={styles.screen}>
        <BackHeader title="Shop" />
        <View style={styles.center}>
          {error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} />}
        </View>
      </Screen>
    );
  }

  const merch = listing.kind === 'merch';
  const order = listing.my_order;
  const manage = listing.can_manage;
  const live = listing.status !== 'removed' && listing.status !== 'hidden';
  const expiresSoon = !merch && listing.expires_at && Date.parse(listing.expires_at) - now < 5 * 24 * 3600_000;

  const actions: SheetAction[] = [];
  if (manage && live) {
    if (merch)
      actions.push({
        label: 'View orders',
        onPress: () => router.push({ pathname: '/shop/orders/[id]', params: { id: listing.id } }),
      });
    if (merch) {
      if (listing.status === 'open') {
        actions.push({
          label: 'Stop taking orders',
          onPress: () =>
            setConfirm({
              title: 'Stop taking orders?',
              message: 'Nobody can order or change an order. You can open orders again before the closing date.',
              action: {
                label: 'Stop orders',
                onPress: () => change(() => setListingStatus(listing.id, 'closed'), 'Orders are closed.'),
              },
            }),
        });
      } else if (listing.closes_at && Date.parse(listing.closes_at) > now) {
        actions.push({
          label: 'Take orders again',
          onPress: () => change(() => setListingStatus(listing.id, 'open'), 'Taking orders again.'),
        });
      }
    } else {
      if (listing.status === 'open')
        actions.push({
          label: 'Mark as sold',
          onPress: () => change(() => setListingStatus(listing.id, 'sold'), 'Marked as sold.'),
        });
      if (listing.status === 'sold')
        actions.push({
          label: 'Put back on sale',
          onPress: () => change(() => setListingStatus(listing.id, 'open'), 'Back on sale for 30 days.'),
        });
    }
    if (!listing.has_orders) {
      actions.push({
        label: 'Remove listing',
        destructive: true,
        onPress: () =>
          setConfirm({
            title: 'Remove this listing?',
            message: 'It leaves the shop for good.',
            action: {
              label: 'Remove',
              destructive: true,
              onPress: () =>
                change(async () => {
                  const r = await setListingStatus(listing.id, 'removed');
                  if (r.data) router.back();
                  return r;
                }),
            },
          }),
      });
    }
  }

  return (
    <Screen style={styles.screen}>
      <BackHeader title={merch ? 'Merch' : 'For sale'} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.stack}>
          <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
            {width > 0 ? (
              <FlatList
                horizontal
                pagingEnabled
                data={listing.photos}
                keyExtractor={(p) => p}
                renderItem={({ item }) => (
                  <PressableScale
                    onPress={() => setViewing({ path: item, title: listing.title })}
                    accessibilityRole="imagebutton"
                    accessibilityLabel="Open photo"
                    scale={0.99}>
                    <ShopImage path={item} style={[styles.photo, { width }]} />
                  </PressableScale>
                )}
                onViewableItemsChanged={onPage}
                viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
                showsHorizontalScrollIndicator={false}
              />
            ) : (
              <View style={styles.photo} />
            )}
            {listing.photos.length > 1 ? (
              <View style={styles.dots}>
                {listing.photos.map((p, i) => (
                  <View key={p} style={[styles.dot, i === page && styles.dotActive]} />
                ))}
              </View>
            ) : null}
          </View>

          <View style={styles.head}>
            <Text style={styles.kicker}>
              {merch
                ? `${listing.club ? `From ${listing.club}` : (listing.batch ?? 'Merch')}${listing.audience === 'university' ? ' · open to the university' : listing.audience === 'everyone' ? ' · open to all universities' : ''}`
                : [
                    conditionLabel(listing.condition),
                    CATEGORIES.find((c) => c.key === listing.category)?.label,
                    listing.other ? listing.institution : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
            </Text>
            <Text style={styles.title} accessibilityRole="header">
              {listing.title}
            </Text>
            <Text style={styles.price}>{price(listing.price)}</Text>
          </View>

          {/* Yours: orders (merch) or interest (items) first, then edit and more. */}
          {manage && live ? (
            <View style={styles.owner}>
              {merch ? (
                <PressableScale
                  onPress={() => router.push({ pathname: '/shop/orders/[id]', params: { id: listing.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Orders received: ${listing.orders?.count ?? 0}${listing.orders?.to_check ? `, ${listing.orders.to_check} slips to check` : ''}. View orders`}
                  scale={0.985}
                  style={styles.ordersRow}>
                  <View style={styles.ordersCount}>
                    <Text style={styles.ordersCountText}>{listing.orders?.count ?? 0}</Text>
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.ownerTitle}>
                      {(listing.orders?.count ?? 0) === 1 ? 'Order received' : 'Orders received'}
                    </Text>
                    <Text style={[styles.ownerBody, (listing.orders?.to_check ?? 0) > 0 && styles.ownerAlert]}>
                      {(listing.orders?.to_check ?? 0) > 0
                        ? `${listing.orders!.to_check} ${listing.orders!.to_check === 1 ? 'slip' : 'slips'} to check`
                        : (listing.orders?.count ?? 0) > 0
                          ? `${listing.orders!.quantity} items · names, phones and slips`
                          : 'New orders show up here and you get a notification'}
                    </Text>
                  </View>
                  <View style={styles.ownerButton}>
                    <Text style={styles.ownerButtonText}>View orders</Text>
                  </View>
                </PressableScale>
              ) : (
                <View style={styles.ordersRow}>
                  <View style={styles.ordersCount}>
                    <Text style={styles.ordersCountText}>{listing.interests?.length ?? 0}</Text>
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.ownerTitle}>Interested</Text>
                    <Text style={styles.ownerBody}>
                      {(listing.interests?.length ?? 0) > 0
                        ? 'Message them below to meet'
                        : 'You get a notification when someone is'}
                    </Text>
                  </View>
                </View>
              )}
              <View style={styles.ownerActions}>
                <View style={styles.flex}>
                  <Button
                    label="Edit"
                    variant="quiet"
                    onPress={() => router.push({ pathname: '/shop/new', params: { kind: listing.kind, id: listing.id } })}
                  />
                </View>
                <View style={styles.flex}>
                  <Button label="More" variant="quiet" loading={busy && !order} onPress={() => setMenu(true)} />
                </View>
              </View>
            </View>
          ) : null}

          {listing.status === 'hidden' ? (
            <Banner
              tone="danger"
              title="Hidden after reports"
              body="Our team is reviewing this listing. It is not in the shop until they finish."
            />
          ) : listing.status === 'removed' ? (
            <Banner tone="danger" title="Removed" body="This listing is no longer in the shop." />
          ) : merch ? (
            <Banner
              title={listing.ordering ? closesLabel(listing.closes_at) : 'Orders are closed'}
              body={
                listing.ordering
                  ? 'Pre-order now; the reps order from the supplier after this.'
                  : 'The reps are no longer taking orders.'
              }
            />
          ) : listing.status === 'sold' ? (
            <Banner title="Sold" body={listing.mine ? 'Put it back on sale with More.' : 'This has been sold.'} />
          ) : null}

          <FormMessage message={error} />
          <FormMessage message={note} tone="info" />

          {/* The student's own order */}
          {order ? (
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>Your order</Text>
                <View
                  style={[
                    styles.pill,
                    order.status === 'rejected' ? styles.pillDanger : order.status === 'placed' ? null : styles.pillDone,
                  ]}>
                  <Text
                    style={[
                      styles.pillText,
                      order.status === 'rejected'
                        ? styles.pillDangerText
                        : order.status === 'placed'
                          ? null
                          : styles.pillDoneText,
                    ]}>
                    {ORDER_STATUS[order.status]}
                  </Text>
                </View>
              </View>
              <Text style={styles.body}>
                {linesLabel(order.lines)} · {price(order.total)}
              </Text>
              {order.status === 'rejected' && order.status_note ? (
                <Text style={styles.danger}>
                  {order.checked_by ?? 'A rep'}: {order.status_note}
                </Text>
              ) : null}
              {order.status !== 'placed' && order.status !== 'rejected' && order.checked_by ? (
                <Text style={styles.muted}>Checked by {order.checked_by}</Text>
              ) : null}
              <Text style={styles.muted}>
                Phone {order.phone}
                {order.note ? ` · ${order.note}` : ''}
              </Text>
              {order.slip_path ? (
                <PressableScale
                  onPress={async () =>
                    isPdf(order.slip_path)
                      ? setError(await openSlip({ path: order.slip_path!, name: 'Your slip.pdf' }))
                      : setViewing({ path: order.slip_path!, title: 'Your slip' })
                  }
                  accessibilityRole="button"
                  hitSlop={6}>
                  <Text style={styles.link}>View your slip</Text>
                </PressableScale>
              ) : null}
              {listing.ordering && (order.status === 'placed' || order.status === 'rejected') ? (
                <View style={styles.buttons}>
                  <View style={styles.flex}>
                    <Button
                      label={order.status === 'rejected' ? 'Fix order' : 'Change'}
                      onPress={() => router.push({ pathname: '/shop/order/[id]', params: { id: listing.id } })}
                    />
                  </View>
                  <View style={styles.flex}>
                    <Button
                      label="Cancel order"
                      variant="quiet"
                      onPress={() =>
                        setConfirm({
                          title: 'Cancel your order?',
                          message: 'If you already paid, message a rep about your refund.',
                          action: {
                            label: 'Cancel order',
                            destructive: true,
                            onPress: () => change(() => cancelOrder(order.id), 'Order cancelled.'),
                          },
                        })
                      }
                    />
                  </View>
                </View>
              ) : null}
            </View>
          ) : merch && listing.ordering && live ? (
            <Button label="Pre-order" onPress={() => router.push({ pathname: '/shop/order/[id]', params: { id: listing.id } })} />
          ) : null}

          {listing.description ? <Text style={styles.body}>{listing.description}</Text> : null}

          {merch && listing.sizes.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.label}>Sizes</Text>
              <View style={styles.sizes}>
                {listing.sizes.map((s) => (
                  <View key={s} style={styles.size}>
                    <Text style={styles.sizeText}>{s}</Text>
                  </View>
                ))}
              </View>
              {listing.size_chart ? (
                <PressableScale
                  onPress={() => setViewing({ path: listing.size_chart!, title: 'Size chart' })}
                  accessibilityRole="button"
                  style={styles.chart}>
                  <RulerIcon size={20} weight="bold" color={theme.accentText} />
                  <Text style={styles.link}>Size chart</Text>
                </PressableScale>
              ) : null}
            </View>
          ) : null}

          {merch && listing.needs_slip && listing.payment_details ? (
            <View style={styles.section}>
              <Text style={styles.label}>How to pay</Text>
              <View style={styles.box}>
                <Text style={[styles.body, styles.flex]} selectable>
                  {listing.payment_details}
                </Text>
                <PressableScale
                  onPress={() => copy(listing.payment_details!, 'Bank details')}
                  accessibilityRole="button"
                  accessibilityLabel="Copy bank details"
                  hitSlop={8}>
                  <CopyIcon size={20} weight="bold" color={theme.accentText} />
                </PressableScale>
              </View>
              <Text style={styles.muted}>Pay the total, then add a photo of your slip when you order.</Text>
            </View>
          ) : merch && !listing.needs_slip ? (
            <Text style={styles.muted}>Pay when you collect.</Text>
          ) : null}

          {merch && listing.collect_details ? (
            <View style={styles.section}>
              <Text style={styles.label}>Collecting</Text>
              <Text style={styles.body}>{listing.collect_details}</Text>
            </View>
          ) : null}

          {/* Items: the seller */}
          {!merch ? (
            <View style={styles.card}>
              <View style={styles.seller}>
                <Avatar name={listing.seller.name} path={listing.seller.avatar_path} />
                <View style={styles.flex}>
                  <Text style={styles.cardTitle}>{listing.mine ? 'You' : listing.seller.name}</Text>
                  <Text style={styles.muted}>Listed {dayMonth(listing.created_at)}</Text>
                </View>
              </View>
              {!listing.mine && live ? (
                <>
                  {listing.status === 'open' ? (
                    listing.interested ? (
                      <Text style={styles.told}>{listing.seller.name.split(' ')[0]} knows you are interested.</Text>
                    ) : (
                      <View style={styles.interest}>
                        <Button
                          label="I'm interested"
                          loading={busy}
                          onPress={() =>
                            change(
                              () => listingInterest(listing.id),
                              `${listing.seller.name.split(' ')[0]} was told. Message them to meet.`,
                            )
                          }
                        />
                      </View>
                    )
                  ) : null}
                  <View style={styles.buttons}>
                    <View style={styles.flex}>
                      <Button label="Message" variant="quiet" onPress={() => message(listing.seller)} />
                    </View>
                    {listing.contact_phone ? (
                      <View style={styles.flex}>
                        <Button
                          label="Call"
                          variant="quiet"
                          onPress={() => Linking.openURL(`tel:${listing.contact_phone}`).catch(() => {})}
                        />
                      </View>
                    ) : null}
                  </View>
                </>
              ) : null}
              {listing.contact_phone ? (
                <PressableScale
                  onPress={() => copy(listing.contact_phone!, 'Number')}
                  accessibilityRole="button"
                  style={styles.phone}>
                  <PhoneIcon size={16} weight="bold" color={theme.textMuted} />
                  <Text style={styles.muted}>{listing.contact_phone}</Text>
                </PressableScale>
              ) : null}
            </View>
          ) : null}

          {!merch && listing.mine && listing.interests ? (
            <View style={styles.section}>
              <Text style={styles.label}>
                {listing.interests.length === 0
                  ? 'Nobody has said they are interested yet'
                  : `Interested (${listing.interests.length})`}
              </Text>
              {listing.interests.map((person) => (
                <View key={person.id} style={styles.person}>
                  <Avatar name={person.name} path={person.avatar_path} />
                  <View style={styles.flex}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {person.name}
                    </Text>
                    <Text style={styles.muted} numberOfLines={1}>
                      {person.batch ?? ''} · {dayMonth(person.at)}
                    </Text>
                  </View>
                  <PressableScale
                    onPress={() => message(person)}
                    accessibilityRole="button"
                    accessibilityLabel={`Message ${person.name}`}
                    style={styles.small}>
                    <Text style={styles.smallText}>Message</Text>
                  </PressableScale>
                </View>
              ))}
            </View>
          ) : null}

          {!merch && !listing.mine ? (
            <View style={styles.tips}>
              <ShieldCheckIcon size={22} weight="bold" color={theme.text} />
              <Text style={styles.tipsText}>
                {listing.other ? `The seller is at ${listing.institution ?? 'another university'}. ` : ''}
                Meet on campus in daylight, check it works, and pay when you collect. Never pay in advance or share codes sent to
                your phone.
              </Text>
            </View>
          ) : null}

          {listing.mine && expiresSoon && listing.status === 'open' ? (
            <Banner
              title={`Leaves the shop ${dayMonth(listing.expires_at!)}`}
              body="Still selling? Keep it up for 30 more days."
              action="Keep it up"
              onPress={() => change(() => setListingStatus(listing.id, 'renew'), 'Up for 30 more days.')}
            />
          ) : null}

          {!listing.mine && live ? (
            <PressableScale
              onPress={() =>
                setReporting({ kind: 'listing', id: listing.id, who: listing.seller.name, userId: listing.seller.id })
              }
              accessibilityRole="button"
              hitSlop={8}>
              <Text style={styles.report}>Report this listing</Text>
            </PressableScale>
          ) : null}
        </View>
      </ScrollView>

      <PhotoViewer photo={viewing} title={viewing?.title} onClose={() => setViewing(null)} />
      <ActionSheet visible={menu} actions={actions} onClose={() => setMenu(false)} />
      <ActionSheet
        visible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        actions={confirm ? [confirm.action] : []}
        onClose={() => setConfirm(null)}
      />
      <ReportSheet target={reporting} onClose={() => setReporting(null)} />
    </Screen>
  );
}

function Banner({
  title,
  body,
  tone = 'accent',
  action,
  onPress,
}: {
  title: string;
  body: string;
  tone?: 'accent' | 'danger';
  action?: string;
  onPress?: () => void;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.banner, tone === 'danger' && styles.bannerDanger]}>
      <View style={styles.flex}>
        <Text style={[styles.bannerTitle, tone === 'danger' && styles.bannerDangerText]}>{title}</Text>
        <Text style={[styles.bannerBody, tone === 'danger' && styles.bannerDangerText]}>{body}</Text>
      </View>
      {action && onPress ? (
        <PressableScale onPress={onPress} accessibilityRole="button" style={styles.bannerButton}>
          <Text style={styles.bannerButtonText}>{action}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  content: { padding: space.xl, paddingTop: space.sm, paddingBottom: space.xxxl },
  stack: { gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  flex: { flex: 1 },
  photo: { width: '100%', aspectRatio: 1, borderRadius: radius.lg },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: space.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.borderFilled },
  dotActive: { backgroundColor: t.text, width: 16 },
  head: { gap: space.xs },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.accentText },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: t.text, letterSpacing: -0.3 },
  price: { fontFamily: fonts.bodyBold, fontSize: 22, color: t.text, marginTop: space.xs },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: t.text },
  muted: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.textMuted },
  danger: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 20, color: t.dangerText },
  link: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.accentText },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  section: { gap: space.sm },
  sizes: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  size: {
    minWidth: 44,
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    backgroundColor: t.surface,
  },
  sizeText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  chart: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start', minHeight: 40 },
  box: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'flex-start',
    backgroundColor: t.surface,
    borderRadius: radius.md,
    padding: space.lg,
  },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  pill: { borderRadius: radius.pill, paddingHorizontal: space.sm + 2, paddingVertical: 3, backgroundColor: t.elevated },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.text },
  pillDone: { backgroundColor: t.accent },
  pillDoneText: { color: t.onAccent },
  pillDanger: { backgroundColor: t.errorBg },
  pillDangerText: { color: t.errorText },
  buttons: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  owner: { borderWidth: 1, borderColor: t.border, borderRadius: radius.lg, padding: space.md, gap: space.md },
  ordersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: t.accentTint,
    borderRadius: radius.md,
    padding: space.md,
  },
  ordersCount: {
    minWidth: 44,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: space.sm,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ordersCountText: { fontFamily: fonts.bodyBold, fontSize: 18, color: t.onAccent },
  ownerTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.onAccentTint },
  ownerBody: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: t.onAccentTint },
  ownerAlert: { fontFamily: fonts.bodyBold },
  ownerButton: {
    backgroundColor: t.accent,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    minHeight: 40,
    justifyContent: 'center',
  },
  ownerButtonText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.onAccent },
  ownerActions: { flexDirection: 'row', gap: space.sm },
  seller: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  interest: { marginTop: space.xs },
  told: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.accentText, marginTop: space.xs },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    padding: space.md,
  },
  small: {
    backgroundColor: t.accent,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: 36,
    justifyContent: 'center',
  },
  smallText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.onAccent },
  phone: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', minHeight: 32 },
  tips: { flexDirection: 'row', gap: space.md, backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg },
  tipsText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.text },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: t.accentTint,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  bannerDanger: { backgroundColor: t.errorBg },
  bannerTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.onAccentTint },
  bannerBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.onAccentTint },
  bannerDangerText: { color: t.errorText },
  bannerButton: {
    backgroundColor: t.accent,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: 40,
    justifyContent: 'center',
  },
  bannerButtonText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.onAccent },
  report: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.dangerText },
}));
