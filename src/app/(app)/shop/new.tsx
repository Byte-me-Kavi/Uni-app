import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';

import { ChoiceChip } from '@/components/shop/choice-chip';
import { PhotoField } from '@/components/shop/photo-field';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { KeyboardFrame, KeyboardScroll } from '@/components/ui/keyboard';
import { weekdayDayMonth } from '@/lib/dates';
import {
  CATEGORIES,
  CONDITIONS,
  loadListing,
  saveListing,
  uploadAll,
  type Audience,
  type Category,
  type Condition,
  type FormPhoto,
  type ListingDraft,
  type ListingKind,
} from '@/lib/shop';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

const PRESET_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
const DAYS = 60;
// Day chips have one width, so the list can open scrolled to the chosen day without measuring.
const DAY_CHIP = 112;
const dayLayout = (_: unknown, index: number) => ({ length: DAY_CHIP, offset: (DAY_CHIP + space.sm) * index, index });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
// Orders close at the end of the chosen day.
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 0, 0);
// Tomorrow and the 59 days after it.
function nextDays() {
  const today = startOfDay(new Date());
  return Array.from({ length: DAYS }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i + 1));
}

const NOT_ALLOWED =
  'Not allowed: exam papers or answers, assignments for sale, alcohol, tobacco, weapons, medicines and fake goods.';

// Publishing to the shop. Merch (reps): photos, sizes and a size chart, price, the last day to
// order, who can order (the batch, the university or every university), bank details for the slip
// and how buyers collect. Items (anyone): photos, category, condition, price, an optional phone
// number and whether other universities see it. Also edits an existing listing.
export default function NewListing() {
  const theme = useTheme();
  const styles = useStyles();
  // as and club: new merch for the rep's batch, or for the merch lead's club or society.
  const params = useLocalSearchParams<{ kind?: ListingKind; id?: string; as?: 'batch' | 'club'; club?: string }>();
  const editingId = params.id ?? null;
  const [kind, setKind] = useState<ListingKind>(params.kind === 'merch' ? 'merch' : 'item');
  const [club, setClub] = useState<string | null>(params.as === 'club' ? (params.club ?? null) : null);
  const [loading, setLoading] = useState(!!editingId);
  const [hasOrders, setHasOrders] = useState(false);
  const [lockedSizes, setLockedSizes] = useState<string[]>([]);

  const [photos, setPhotos] = useState<FormPhoto[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priceText, setPriceText] = useState('');
  // merch
  const [sizes, setSizes] = useState<string[]>(['S', 'M', 'L', 'XL']);
  const [extraSizes, setExtraSizes] = useState<string[]>([]);
  const [newSize, setNewSize] = useState('');
  const [chart, setChart] = useState<FormPhoto[]>([]);
  const [days, setDays] = useState(nextDays);
  const [day, setDay] = useState(6); // a week from tomorrow
  // Club merch is never for one batch.
  const [audience, setAudience] = useState<Audience>(params.as === 'club' ? 'university' : 'batch');
  const [itemAudience, setItemAudience] = useState<'university' | 'everyone'>('university');
  const [needsSlip, setNeedsSlip] = useState(true);
  const [payment, setPayment] = useState('');
  const [collect, setCollect] = useState('');
  // item
  const [category, setCategory] = useState<Category | null>(null);
  const [condition, setCondition] = useState<Condition | null>(null);
  const [phone, setPhone] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editingId) return;
    let live = true;
    loadListing(editingId).then((r) => {
      if (!live) return;
      setLoading(false);
      if (!r.data) return setError(r.error);
      const l = r.data;
      setKind(l.kind);
      setHasOrders(l.has_orders);
      setPhotos(l.photos.map((path) => ({ key: path, path })));
      setTitle(l.title);
      setDescription(l.description ?? '');
      setPriceText(String(l.price));
      if (l.kind === 'merch') {
        setSizes(l.sizes);
        setExtraSizes(l.sizes.filter((s) => !PRESET_SIZES.includes(s)));
        if (l.has_orders) setLockedSizes(l.sizes);
        setChart(l.size_chart ? [{ key: l.size_chart, path: l.size_chart }] : []);
        setAudience(l.audience);
        setClub(l.club);
        setNeedsSlip(l.needs_slip);
        setPayment(l.payment_details ?? '');
        setCollect(l.collect_details ?? '');
        if (l.closes_at) {
          // The day it closes now, added in front when it is not one of the next 60.
          const closes = startOfDay(new Date(l.closes_at));
          const list = nextDays();
          const at = list.findIndex((d) => d.getTime() === closes.getTime());
          if (at < 0) setDays([closes, ...list]);
          setDay(Math.max(at, 0));
        }
      } else {
        setCategory(l.category);
        setCondition(l.condition);
        setItemAudience(l.audience === 'everyone' ? 'everyone' : 'university');
        setPhone(l.contact_phone ?? '');
      }
    });
    return () => {
      live = false;
    };
  }, [editingId]);

  const merch = kind === 'merch';
  const allSizes = [...PRESET_SIZES, ...extraSizes];

  function toggleSize(s: string) {
    if (lockedSizes.includes(s)) return setError('People have ordered this size, so it stays.');
    setSizes((list) => (list.includes(s) ? list.filter((x) => x !== s) : allSizes.filter((x) => x === s || list.includes(x))));
  }

  function addSize() {
    const s = newSize.trim().slice(0, 12);
    if (!s) return;
    if (!allSizes.includes(s)) setExtraSizes((list) => [...list, s]);
    setSizes((list) => (list.includes(s) ? list : [...list, s]));
    setNewSize('');
  }

  async function publish() {
    setError(null);
    const price = Number(priceText.replace(/[^0-9]/g, ''));
    if (photos.length === 0) return setError('Add at least one photo.');
    if (title.trim().length < 3) return setError('Give it a name.');
    if (!priceText.trim() || (merch && price < 1)) return setError('Enter the price in rupees.');
    if (!merch && !category) return setError('Choose a category.');
    if (!merch && !condition) return setError('Choose its condition.');
    if (merch && needsSlip && !payment.trim()) return setError('Add the bank details buyers pay to.');

    setSaving(true);
    const keep = (set: typeof setPhotos) => (key: string, path: string) =>
      set((list) => list.map((p) => (p.key === key ? { ...p, path } : p)));
    const up = await uploadAll('photo', photos, keep(setPhotos));
    if ('error' in up) {
      setSaving(false);
      return setError(up.error);
    }
    let chartPath: string | null = null;
    if (merch && chart.length > 0) {
      const c = await uploadAll('chart', chart, keep(setChart));
      if ('error' in c) {
        setSaving(false);
        return setError(c.error);
      }
      chartPath = c.paths[0] ?? null;
    }

    const draft: ListingDraft = merch
      ? {
          kind,
          as: club ? 'club' : 'batch',
          title: title.trim(),
          description: description.trim(),
          price,
          photos: up.paths,
          sizes: allSizes.filter((s) => sizes.includes(s)),
          size_chart: chartPath,
          closes_at: endOfDay(days[day]).toISOString(),
          audience,
          needs_slip: needsSlip,
          payment_details: needsSlip ? payment.trim() : '',
          collect_details: collect.trim(),
        }
      : {
          kind,
          title: title.trim(),
          description: description.trim(),
          price,
          photos: up.paths,
          category: category!,
          condition: condition!,
          audience: itemAudience,
          contact_phone: phone.trim(),
        };
    const r = await saveListing(editingId, draft);
    setSaving(false);
    if (r.error || !r.data) return setError(r.error);
    if (editingId) router.back();
    else router.replace({ pathname: '/shop/[id]', params: { id: r.data.id } });
  }

  if (loading) {
    return (
      <Screen style={styles.screen}>
        <BackHeader title="Edit listing" />
        <View style={styles.center}>
          <ActivityIndicator color={theme.accentText} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen style={styles.screen}>
      <BackHeader
        title={editingId ? 'Edit listing' : merch ? (club ? `Merch for ${club}` : 'Publish merch') : 'Sell something'}
      />
      <KeyboardFrame style={styles.flex}>
        <KeyboardScroll contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.stack}>
            {merch ? (
              <Text style={styles.hint}>
                Like your Google Form, in the app: students pick sizes, pay to your account and add their slip.{' '}
                {club
                  ? `You and the other merch leads of ${club} see every order with their name, batch, email and phone.`
                  : 'You and the other reps of your batch see every order with their name, batch, email and phone.'}
              </Text>
            ) : (
              <Text style={styles.hint}>
                {
                  "Students tap I'm interested (you get a notification) or message you, and you meet in person. Nothing is paid through the app."
                }
              </Text>
            )}

            <PhotoField
              label="Photos"
              hint={merch ? 'The design, front and back. Up to 6.' : 'Clear photos from a few sides. Up to 6.'}
              kind="photo"
              max={6}
              photos={photos}
              onChange={setPhotos}
              onError={setError}
            />

            <TextField
              label="Name"
              value={title}
              onChangeText={setTitle}
              placeholder={merch ? 'e.g. 2025 Batch T-shirt' : 'e.g. Casio fx-991ES Plus'}
              maxLength={80}
            />

            {!merch ? (
              <>
                <Group label="Category">
                  <View style={styles.chips}>
                    {CATEGORIES.map((c) => (
                      <ChoiceChip key={c.key} label={c.label} active={category === c.key} onPress={() => setCategory(c.key)} />
                    ))}
                  </View>
                </Group>
                <Group label="Condition">
                  <View style={styles.chips}>
                    {CONDITIONS.map((c) => (
                      <ChoiceChip key={c.key} label={c.label} active={condition === c.key} onPress={() => setCondition(c.key)} />
                    ))}
                  </View>
                </Group>
              </>
            ) : null}

            <TextField
              label={merch ? 'Price for one (Rs)' : 'Price (Rs)'}
              value={priceText}
              onChangeText={(t) => setPriceText(t.replace(/[^0-9]/g, '').slice(0, 8))}
              placeholder={merch ? '1800' : '3500 (0 to give it away)'}
              keyboardType="number-pad"
              editable={!hasOrders}
              hint={hasOrders ? 'People have ordered, so the price stays the same.' : undefined}
            />

            <TextField
              label="Description (optional)"
              value={description}
              onChangeText={setDescription}
              placeholder={merch ? 'Fabric, colours, print, when they arrive' : 'How old it is, what comes with it, any faults'}
              multiline
              maxLength={2000}
            />

            {merch ? (
              <>
                <Group label="Sizes">
                  <View style={styles.chips}>
                    {allSizes.map((s) => (
                      <ChoiceChip key={s} label={s} multi active={sizes.includes(s)} onPress={() => toggleSize(s)} />
                    ))}
                  </View>
                  <View style={styles.addRow}>
                    <View style={styles.flex}>
                      <TextField
                        label="Another size"
                        value={newSize}
                        onChangeText={setNewSize}
                        placeholder="e.g. 4XL or Free size"
                        maxLength={12}
                        onSubmitEditing={addSize}
                        returnKeyType="done"
                      />
                    </View>
                    <PressableScale
                      onPress={addSize}
                      accessibilityRole="button"
                      accessibilityLabel="Add size"
                      style={styles.addButton}>
                      <PlusIcon size={22} weight="bold" color={theme.onAccent} />
                    </PressableScale>
                  </View>
                  <Text style={styles.hint}>No sizes chosen: students just choose how many.</Text>
                </Group>

                <PhotoField
                  label="Size chart (optional)"
                  hint="A photo of the supplier's chart, so students pick the right size."
                  kind="chart"
                  max={1}
                  photos={chart}
                  onChange={setChart}
                  onError={setError}
                />

                <Group label="Last day to order">
                  <FlatList
                    horizontal
                    data={days}
                    keyExtractor={(d) => String(d.getTime())}
                    extraData={day}
                    renderItem={({ item, index }) => (
                      <ChoiceChip
                        width={DAY_CHIP}
                        label={weekdayDayMonth(item)}
                        active={index === day}
                        onPress={() => setDay(index)}
                      />
                    )}
                    getItemLayout={dayLayout}
                    initialScrollIndex={Math.max(day - 1, 0)}
                    initialNumToRender={5}
                    maxToRenderPerBatch={8}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.row}
                  />
                  <Text style={styles.hint}>Orders close at 11:59 pm that day.</Text>
                </Group>

                <Group label="Who can order">
                  <View style={styles.chips}>
                    {!club ? (
                      <ChoiceChip label="My batch" active={audience === 'batch'} onPress={() => setAudience('batch')} />
                    ) : null}
                    <ChoiceChip
                      label="My university"
                      active={audience === 'university'}
                      onPress={() => setAudience('university')}
                    />
                    <ChoiceChip
                      label="All universities"
                      active={audience === 'everyone'}
                      onPress={() => setAudience('everyone')}
                    />
                  </View>
                </Group>

                <Group label="Payment">
                  <View style={styles.chips}>
                    <ChoiceChip label="Bank transfer and slip" active={needsSlip} onPress={() => setNeedsSlip(true)} />
                    <ChoiceChip label="Pay when collecting" active={!needsSlip} onPress={() => setNeedsSlip(false)} />
                  </View>
                </Group>
                {needsSlip ? (
                  <TextField
                    label="Bank details"
                    value={payment}
                    onChangeText={setPayment}
                    placeholder={'Bank of Ceylon, Kandy\nAccount 1234567\nR. Perera'}
                    multiline
                    maxLength={500}
                    hint="Students see this and upload their slip when they order."
                  />
                ) : null}
                <TextField
                  label="Collecting (optional)"
                  value={collect}
                  onChangeText={setCollect}
                  placeholder="e.g. Faculty canteen, the week after orders close"
                  multiline
                  maxLength={300}
                />
              </>
            ) : (
              <>
                <Group label="Who can see it">
                  <View style={styles.chips}>
                    <ChoiceChip
                      label="My university"
                      active={itemAudience === 'university'}
                      onPress={() => setItemAudience('university')}
                    />
                    <ChoiceChip
                      label="All universities"
                      active={itemAudience === 'everyone'}
                      onPress={() => setItemAudience('everyone')}
                    />
                  </View>
                  <Text style={styles.hint}>
                    {itemAudience === 'everyone'
                      ? 'Students at every university can find it under Other unis, and see your name and university.'
                      : 'Only students at your university can find it.'}
                  </Text>
                </Group>
                <TextField
                  label="Phone number (optional)"
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="077 123 4567"
                  keyboardType="phone-pad"
                  maxLength={20}
                  hint="Shown on your listing to everyone who can see it. Leave it empty to be contacted by message only."
                />
                <Text style={styles.hint}>{NOT_ALLOWED} Listings stay up for 30 days; you can renew them.</Text>
              </>
            )}

            <FormMessage message={error} />
            <Button label={editingId ? 'Save changes' : 'Publish'} loading={saving} onPress={publish} />
          </View>
        </KeyboardScroll>
      </KeyboardFrame>
    </Screen>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  content: { padding: space.xl, paddingTop: space.sm, paddingBottom: space.xxxl },
  stack: { gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  group: { gap: space.sm },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  hint: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { gap: space.sm, paddingRight: space.xl },
  addRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  addButton: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
