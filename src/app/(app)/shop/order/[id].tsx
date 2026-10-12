import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { CopyIcon } from 'phosphor-react-native/src/icons/Copy';
import { MinusIcon } from 'phosphor-react-native/src/icons/Minus';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { RulerIcon } from 'phosphor-react-native/src/icons/Ruler';

import { PhotoField } from '@/components/shop/photo-field';
import { PhotoViewer, ShopImage } from '@/components/shop/shop-image';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { KeyboardFrame, KeyboardScroll } from '@/components/ui/keyboard';
import {
  closesLabel,
  copyText,
  isPdf,
  loadListing,
  placeOrder,
  price,
  uploadAll,
  type FormPhoto,
  type Listing,
} from '@/lib/shop';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

const NO_SIZE = '';
const MAX_EACH = 20;

// Pre-ordering merch: how many of each size, pay to the reps' account, add the slip, and a phone
// number the reps can call about delivery. Changing an order (before a rep confirms it) opens the
// same form, filled in.
export default function OrderScreen() {
  const theme = useTheme();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [listing, setListing] = useState<Listing | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [slip, setSlip] = useState<FormPhoto[]>([]);
  const [chart, setChart] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    loadListing(id).then((r) => {
      if (!live) return;
      setError(r.error);
      if (!r.data) return;
      const l = r.data;
      setListing(l);
      const order = l.my_order;
      if (order) {
        setCounts(Object.fromEntries(order.lines.map((line) => [line.size ?? NO_SIZE, line.quantity])));
        setPhone(order.phone);
        setNote(order.note ?? '');
        if (order.slip_path) setSlip([{ key: 'slip', path: order.slip_path, pdf: isPdf(order.slip_path) }]);
      } else {
        setPhone(l.my_phone ?? '');
        if (l.sizes.length === 0) setCounts({ [NO_SIZE]: 1 });
      }
    });
    return () => {
      live = false;
    };
  }, [id]);

  if (!listing) {
    return (
      <Screen style={styles.screen}>
        <BackHeader title="Pre-order" />
        <View style={styles.center}>
          {error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} />}
        </View>
      </Screen>
    );
  }

  const sizes = listing.sizes.length > 0 ? listing.sizes : [NO_SIZE];
  const quantity = sizes.reduce((n, s) => n + (counts[s] ?? 0), 0);
  const total = quantity * listing.price;

  function step(size: string, by: number) {
    setCounts((c) => ({ ...c, [size]: Math.max(0, Math.min(MAX_EACH, (c[size] ?? 0) + by)) }));
  }

  async function send() {
    if (!listing) return;
    if (quantity === 0) return setError(listing.sizes.length ? 'Choose at least one size.' : 'Choose how many.');
    if (phone.replace(/[^0-9]/g, '').length < 9) return setError('Enter your phone number, so the reps can reach you.');
    if (listing.needs_slip && slip.length === 0) return setError('Add a photo of your payment slip.');
    setSaving(true);
    setError(null);
    const uploaded = await uploadAll('slip', slip, (key, path) =>
      setSlip((s) => s.map((p) => (p.key === key ? { ...p, path } : p))),
    );
    if ('error' in uploaded) {
      setSaving(false);
      return setError(uploaded.error);
    }
    const r = await placeOrder(listing.id, {
      lines: sizes.filter((s) => (counts[s] ?? 0) > 0).map((s) => ({ size: s || null, quantity: counts[s] })),
      phone: phone.trim(),
      note,
      slip: uploaded.paths[0] ?? null,
    });
    setSaving(false);
    if (r.error) return setError(r.error);
    router.back();
  }

  const editing = !!listing.my_order;

  return (
    <Screen style={styles.screen}>
      <BackHeader title={editing ? 'Your order' : 'Pre-order'} />
      <KeyboardFrame style={styles.flex}>
        <KeyboardScroll contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.stack}>
            <View style={styles.summary}>
              <ShopImage path={listing.photo} style={styles.thumb} />
              <View style={styles.flex}>
                <Text style={styles.title} numberOfLines={2}>
                  {listing.title}
                </Text>
                <Text style={styles.muted}>
                  {price(listing.price)} each · {closesLabel(listing.closes_at)}
                </Text>
              </View>
            </View>

            <View style={styles.group}>
              <View style={styles.rowBetween}>
                <Text style={styles.label}>{listing.sizes.length ? 'Sizes' : 'How many'}</Text>
                {listing.size_chart ? (
                  <PressableScale onPress={() => setChart(true)} accessibilityRole="button" hitSlop={8} style={styles.chartLink}>
                    <RulerIcon size={18} weight="bold" color={theme.accentText} />
                    <Text style={styles.link}>Size chart</Text>
                  </PressableScale>
                ) : null}
              </View>
              <View style={styles.lines}>
                {sizes.map((s, i) => (
                  <View key={s || 'one'} style={[styles.line, i > 0 && styles.lineDivider]}>
                    <Text style={styles.size}>{s || listing.title}</Text>
                    <View style={styles.stepper}>
                      <PressableScale
                        onPress={() => step(s, -1)}
                        disabled={(counts[s] ?? 0) === 0}
                        accessibilityRole="button"
                        accessibilityLabel={`One less${s ? ` ${s}` : ''}`}
                        hitSlop={6}
                        style={[styles.stepButton, (counts[s] ?? 0) === 0 && styles.stepOff]}>
                        <MinusIcon size={18} weight="bold" color={theme.text} />
                      </PressableScale>
                      <Text style={styles.count} accessibilityLiveRegion="polite">
                        {counts[s] ?? 0}
                      </Text>
                      <PressableScale
                        onPress={() => step(s, 1)}
                        accessibilityRole="button"
                        accessibilityLabel={`One more${s ? ` ${s}` : ''}`}
                        hitSlop={6}
                        style={[styles.stepButton, styles.stepAdd]}>
                        <PlusIcon size={18} weight="bold" color={theme.onAccent} />
                      </PressableScale>
                    </View>
                  </View>
                ))}
              </View>
              <View style={styles.total}>
                <Text style={styles.totalLabel}>Total{quantity > 0 ? ` for ${quantity}` : ''}</Text>
                <Text style={styles.totalValue}>{price(total)}</Text>
              </View>
            </View>

            {listing.needs_slip ? (
              <>
                <View style={styles.group}>
                  <Text style={styles.label}>Pay {quantity > 0 ? price(total) : 'the total'} to</Text>
                  <View style={styles.box}>
                    <Text style={[styles.body, styles.flex]} selectable>
                      {listing.payment_details}
                    </Text>
                    <PressableScale
                      onPress={async () => setCopied(await copyText(listing.payment_details ?? ''))}
                      accessibilityRole="button"
                      accessibilityLabel="Copy bank details"
                      hitSlop={8}>
                      <CopyIcon size={20} weight="bold" color={theme.accentText} />
                    </PressableScale>
                  </View>
                  {copied ? <Text style={styles.muted}>Copied.</Text> : null}
                </View>
                <PhotoField
                  label="Payment slip"
                  hint="A photo, screenshot or PDF of the slip or the bank app's receipt, with the amount and date readable. Only you and the reps running this order see it."
                  kind="slip"
                  allowPdf
                  max={1}
                  photos={slip}
                  onChange={setSlip}
                  onError={setError}
                />
              </>
            ) : (
              <Text style={styles.muted}>Pay when you collect.</Text>
            )}

            <TextField
              label="Phone number"
              value={phone}
              onChangeText={setPhone}
              placeholder="077 123 4567"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              maxLength={20}
              hint="For the reps and the delivery. Only they see it."
            />
            <TextField
              label="Note for the reps (optional)"
              value={note}
              onChangeText={setNote}
              placeholder="e.g. Name on the back: KAVI, or where to deliver"
              multiline
              maxLength={300}
            />

            {listing.collect_details ? (
              <View style={styles.group}>
                <Text style={styles.label}>Collecting</Text>
                <Text style={styles.body}>{listing.collect_details}</Text>
              </View>
            ) : null}

            <Text style={styles.muted}>
              Your name, batch, university email and phone number go to the reps running this order.
            </Text>
            <FormMessage message={error} />
            <Button label={editing ? 'Update order' : `Place order · ${price(total)}`} loading={saving} onPress={send} />
          </View>
        </KeyboardScroll>
      </KeyboardFrame>
      <PhotoViewer photo={chart ? { path: listing.size_chart } : null} title="Size chart" onClose={() => setChart(false)} />
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  flex: { flex: 1 },
  content: { padding: space.xl, paddingTop: space.sm, paddingBottom: space.xxxl },
  stack: { gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  thumb: { width: 64, height: 64, borderRadius: radius.md },
  title: { fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  muted: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.textMuted },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: t.text },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  link: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.accentText },
  group: { gap: space.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chartLink: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 32 },
  lines: { backgroundColor: t.surface, borderRadius: radius.lg, paddingHorizontal: space.lg },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 60, gap: space.md },
  lineDivider: { borderTopWidth: 1, borderTopColor: t.border },
  size: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: t.borderFilled,
  },
  stepAdd: { backgroundColor: t.accent, borderColor: t.accent },
  stepOff: { opacity: 0.35 },
  count: { minWidth: 24, textAlign: 'center', fontFamily: fonts.bodyBold, fontSize: 17, color: t.text },
  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: space.xs },
  totalLabel: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: t.textMuted },
  totalValue: { fontFamily: fonts.bodyBold, fontSize: 20, color: t.text },
  box: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'flex-start',
    backgroundColor: t.surface,
    borderRadius: radius.md,
    padding: space.lg,
  },
}));
