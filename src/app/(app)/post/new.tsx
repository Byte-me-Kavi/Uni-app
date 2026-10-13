import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { ChatTeardropTextIcon } from 'phosphor-react-native/src/icons/ChatTeardropText';
import { ImageIcon } from 'phosphor-react-native/src/icons/Image';
import { XIcon } from 'phosphor-react-native/src/icons/X';

import { lookOf, type Look } from '@/components/feed/post-look';
import { ChoiceChip } from '@/components/shop/choice-chip';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { KeyboardFrame, KeyboardScroll } from '@/components/ui/keyboard';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { readCache } from '@/lib/cache';
import { dayMonth } from '@/lib/dates';
import {
  createPost,
  editPost,
  FACILITIES,
  GENDER_LABEL,
  PER_LABEL,
  peekPost,
  pickPostPhotos,
  photoUrl,
  ROOM_LABEL,
  type BodimDetails,
  type BodimGender,
  type BodimRoom,
  type Facility,
  type FeedStart,
  type JobDetails,
  type JobPer,
  type LostFoundDetails,
  type PickedPhoto,
  type PostTag,
} from '@/lib/feed';
import { useSession } from '@/providers/session-provider';
import { useScheme } from '@/theme/appearance';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

const MAX_PHOTOS = 4;
const MAX_LENGTH = 1000;

type Kind = 'post' | PostTag;

// The 1st of the next three months, for "Free from".
const firstOfMonths = () => {
  const now = new Date();
  return [1, 2, 3].map((n) => new Date(now.getFullYear(), now.getMonth() + n, 1));
};
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const PLACEHOLDER: Record<Kind, string> = {
  post: 'What is happening at uni?',
  question: 'What do you want to ask? Be specific, like the module or the place.',
  lost_found: 'What is it? Colour, brand, anything that helps.',
  notice: 'What does everyone need to know?',
  bodim: 'Anything else: rules, the landlord, how to get there (optional)',
  job: 'What they will do, who you need, how to apply (optional)',
};

// "Apply by": a week, two weeks or a month from today, or no closing day.
const closingDays = () => [7, 14, 30].map((n) => new Date(Date.now() + n * 86_400_000));

// Writing or editing a post. First the kind, as coloured tiles (Post, Question, Lost & found,
// Bodim, and Notice for reps, merch leads and staff); each kind asks only what it needs. A bodim
// asks for the rent, who it is for, the kind of place, where, how far to walk, facilities, when it
// is free and an optional phone. A job asks what it is, the pay, where (or remote), hours, a closing
// day and an optional phone. Lost & found asks lost or found, and where. Then who sees it. The
// Post button sits above the keyboard. Opened from the photo button, it starts on the picker;
// opened with ?type=bodim, on that kind; with ?edit=<id>, on that post (kind and photos fixed).
export default function NewPost() {
  const theme = useTheme();
  const scheme = useScheme();
  const styles = useStyles();
  const session = useSession();
  const params = useLocalSearchParams<{ photos?: string; edit?: string; type?: string }>();
  const editing = params.edit ? peekPost(Number(params.edit)) : undefined;
  const [noticeAs] = useState(() =>
    session.status === 'signed_in' ? (readCache<FeedStart>(`${session.session.user.id}:feed`)?.notice_as ?? null) : null,
  );
  const startKind: Kind =
    editing?.tag ?? (['question', 'lost_found', 'bodim', 'job'].includes(params.type ?? '') ? (params.type as Kind) : 'post');
  const startBodim = editing?.tag === 'bodim' ? (editing.details as BodimDetails) : null;
  const startJob = editing?.tag === 'job' ? (editing.details as JobDetails) : null;
  const startLost = editing?.tag === 'lost_found' ? (editing.details as LostFoundDetails) : null;

  const [kind, setKind] = useState<Kind>(startKind);
  const [body, setBody] = useState(editing?.body ?? '');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [everyone, setEveryone] = useState(editing?.audience === 'everyone');
  // Lost & found
  const [lostKind, setLostKind] = useState<'lost' | 'found' | null>(startLost?.kind ?? null);
  const [where, setWhere] = useState(startLost?.where ?? '');
  // Bodim
  const [rent, setRent] = useState(startBodim ? String(startBodim.rent) : '');
  const [gender, setGender] = useState<BodimGender | null>(startBodim?.gender ?? null);
  const [room, setRoom] = useState<BodimRoom | null>(startBodim?.room ?? null);
  const [area, setArea] = useState(startBodim?.area ?? startJob?.area ?? '');
  const [walk, setWalk] = useState(startBodim?.walk !== undefined ? String(startBodim.walk) : '');
  const [facilities, setFacilities] = useState<Facility[]>(startBodim?.facilities ?? []);
  const [freeFrom, setFreeFrom] = useState<string | null>(startBodim?.available_from ?? null);
  const [phone, setPhone] = useState(startBodim?.phone ?? startJob?.phone ?? '');
  // Job (area and phone shared with bodim above)
  const [role, setRole] = useState(startJob?.role ?? '');
  const [pay, setPay] = useState(startJob?.pay ? String(startJob.pay) : '');
  const [per, setPer] = useState<JobPer>(startJob?.per ?? 'hour');
  const [remote, setRemote] = useState(!!startJob?.remote);
  const [hours, setHours] = useState(startJob?.hours ?? '');
  const [closesOn, setClosesOn] = useState<string | null>(startJob?.closes_on ?? null);
  const [closing] = useState(closingDays);

  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<TextInput>(null);
  const [months] = useState(firstOfMonths);

  async function addPhotos() {
    setError(null);
    setPreparing(true);
    const r = await pickPostPhotos(MAX_PHOTOS - photos.length);
    setPreparing(false);
    if (!r) return;
    if ('error' in r) return setError(r.error);
    setPhotos((p) => [...p, ...r].slice(0, MAX_PHOTOS));
  }

  useEffect(() => {
    if (params.photos !== '1') {
      if (startKind === 'post' || startKind === 'question') input.current?.focus();
      return;
    }
    // After the screen has slid in, so the picker does not open over the animation.
    const timer = setTimeout(addPhotos, 300);
    return () => clearTimeout(timer);
    // Once, when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function details(): LostFoundDetails | BodimDetails | JobDetails | null | string {
    if (kind === 'lost_found') {
      if (!lostKind) return 'Say whether you lost or found it.';
      return { kind: lostKind, ...(where.trim() ? { where: where.trim() } : {}) };
    }
    if (kind === 'bodim') {
      const amount = Number(rent.replace(/[^0-9]/g, ''));
      if (!amount) return 'Enter the monthly rent.';
      if (!gender) return 'Say who the place is for.';
      if (!room) return 'Choose the kind of place.';
      if (area.trim().length < 2) return 'Say where it is.';
      return {
        rent: amount,
        gender,
        room,
        area: area.trim(),
        ...(walk.trim() ? { walk: Number(walk.replace(/[^0-9]/g, '')) } : {}),
        ...(facilities.length ? { facilities } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(freeFrom ? { available_from: freeFrom } : {}),
      };
    }
    if (kind === 'job') {
      if (role.trim().length < 2) return 'Say what the job is.';
      if (!remote && area.trim().length < 2) return 'Say where the work is, or choose Remote.';
      const amount = Number(pay.replace(/[^0-9]/g, ''));
      return {
        role: role.trim(),
        ...(amount ? { pay: amount, per } : {}),
        ...(remote ? { remote: true } : {}),
        ...(area.trim() ? { area: area.trim() } : {}),
        ...(hours.trim() ? { hours: hours.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(closesOn ? { closes_on: closesOn } : {}),
      };
    }
    return null;
  }

  async function send() {
    setError(null);
    const d = details();
    if (typeof d === 'string') return setError(d);
    const tag = kind === 'post' ? null : kind;
    if (!body.trim() && photos.length === 0 && !editing?.photos.length && tag !== 'bodim' && tag !== 'job') {
      return setError('Write something or add a photo.');
    }
    setSending(true);
    const audience = everyone ? 'everyone' : 'university';
    const r = editing
      ? await editPost(editing.id, { body: body.trim(), details: d, audience })
      : await createPost({ body: body.trim(), tag, details: d, audience, photos }, (share) => setProgress(share));
    setSending(false);
    setProgress(null);
    if (r.error !== null) return setError(r.error);
    router.back();
  }

  const kinds: Kind[] = noticeAs
    ? ['post', 'question', 'lost_found', 'bodim', 'job', 'notice']
    : ['post', 'question', 'lost_found', 'bodim', 'job'];
  const lookFor = (k: Kind) =>
    k === 'post'
      ? null
      : lookOf({ tag: k, details: k === 'lost_found' ? { kind: lostKind ?? 'lost' } : null, notice_from: null }, theme, scheme);
  const look = lookFor(kind);
  const left = MAX_LENGTH - body.length;

  return (
    <Screen style={styles.screen}>
      <BackHeader title={editing ? 'Edit post' : 'New post'} />
      <KeyboardFrame style={styles.flex}>
        <KeyboardScroll contentContainerStyle={styles.content}>
          <View style={styles.stack}>
            {editing ? null : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kinds}>
                {kinds.map((k) => (
                  <KindTile
                    key={k}
                    look={lookFor(k)}
                    active={kind === k}
                    label={
                      k === 'notice'
                        ? 'Notice'
                        : k === 'lost_found'
                          ? 'Lost & found'
                          : k === 'post'
                            ? 'Post'
                            : k === 'bodim'
                              ? 'Bodim'
                              : k === 'job'
                                ? 'Job'
                                : 'Question'
                    }
                    onPress={() => setKind(k)}
                  />
                ))}
              </ScrollView>
            )}
            {kind === 'notice' && !editing ? (
              <Text style={styles.hint}>{`Shown as a notice from ${noticeAs}, higher in everyone's feed.`}</Text>
            ) : null}

            {kind === 'lost_found' ? (
              <>
                <View style={styles.group}>
                  <Text style={styles.label}>Did you lose or find something?</Text>
                  <View style={styles.split}>
                    {(['lost', 'found'] as const).map((k) => {
                      const l = lookOf({ tag: 'lost_found', details: { kind: k }, notice_from: null }, theme, scheme)!;
                      const on = lostKind === k;
                      return (
                        <PressableScale
                          key={k}
                          onPress={() => setLostKind(k)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on }}
                          style={[styles.bigChoice, { borderColor: l.solid }, on && { backgroundColor: l.solid }]}>
                          <l.Icon size={20} weight="bold" color={on ? l.onSolid : l.solid} />
                          <Text style={[styles.bigChoiceText, { color: on ? l.onSolid : l.text }]}>
                            {k === 'lost' ? 'I lost it' : 'I found it'}
                          </Text>
                        </PressableScale>
                      );
                    })}
                  </View>
                </View>
                <TextField
                  label={lostKind === 'found' ? 'Where did you find it? (optional)' : 'Where did you lose it? (optional)'}
                  value={where}
                  onChangeText={setWhere}
                  placeholder="e.g. Library, 2nd floor"
                  maxLength={80}
                />
              </>
            ) : null}

            {kind === 'bodim' ? (
              <>
                <TextField
                  label="Rent a month (Rs)"
                  value={rent}
                  onChangeText={(v) => setRent(v.replace(/[^0-9,]/g, ''))}
                  placeholder="e.g. 15000"
                  keyboardType="number-pad"
                  maxLength={8}
                />
                <ChipGroup label="Who is it for?">
                  {(Object.keys(GENDER_LABEL) as BodimGender[]).map((g) => (
                    <ChoiceChip key={g} label={GENDER_LABEL[g]} active={gender === g} onPress={() => setGender(g)} />
                  ))}
                </ChipGroup>
                <ChipGroup label="What kind of place?">
                  {(Object.keys(ROOM_LABEL) as BodimRoom[]).map((r) => (
                    <ChoiceChip key={r} label={ROOM_LABEL[r]} active={room === r} onPress={() => setRoom(r)} />
                  ))}
                </ChipGroup>
                <TextField
                  label="Where is it?"
                  value={area}
                  onChangeText={setArea}
                  placeholder="e.g. Near Gate 2, Dalugama"
                  maxLength={80}
                />
                <TextField
                  label="Minutes' walk to campus (optional)"
                  value={walk}
                  onChangeText={(v) => setWalk(v.replace(/[^0-9]/g, ''))}
                  placeholder="e.g. 8"
                  keyboardType="number-pad"
                  maxLength={3}
                />
                <ChipGroup label="What does it have?">
                  {FACILITIES.map(([key, label]) => (
                    <ChoiceChip
                      key={key}
                      multi
                      label={label}
                      active={facilities.includes(key)}
                      onPress={() => setFacilities((all) => (all.includes(key) ? all.filter((f) => f !== key) : [...all, key]))}
                    />
                  ))}
                </ChipGroup>
                <ChipGroup label="Free from">
                  <ChoiceChip label="Now" active={!freeFrom} onPress={() => setFreeFrom(null)} />
                  {months.map((m) => (
                    <ChoiceChip
                      key={isoDay(m)}
                      label={dayMonth(m)}
                      active={freeFrom === isoDay(m)}
                      onPress={() => setFreeFrom(isoDay(m))}
                    />
                  ))}
                </ChipGroup>
                <TextField
                  label="Phone (optional)"
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="07X XXX XXXX"
                  keyboardType="phone-pad"
                  maxLength={20}
                  hint="Shown on the post with a Call button. Leave empty to be messaged in the app instead."
                />
              </>
            ) : null}

            {kind === 'job' ? (
              <>
                <TextField
                  label="What is the job?"
                  value={role}
                  onChangeText={setRole}
                  placeholder="e.g. Maths tutor for O/L"
                  maxLength={80}
                />
                <TextField
                  label="Pay in Rs (optional)"
                  value={pay}
                  onChangeText={(v) => setPay(v.replace(/[^0-9,]/g, ''))}
                  placeholder="e.g. 1500"
                  keyboardType="number-pad"
                  maxLength={9}
                  hint={pay.trim() ? undefined : 'Leave empty to agree the pay with whoever applies.'}
                />
                {pay.trim() ? (
                  <ChipGroup label="Pay is">
                    {(Object.keys(PER_LABEL) as JobPer[]).map((k) => (
                      <ChoiceChip key={k} label={PER_LABEL[k]} active={per === k} onPress={() => setPer(k)} />
                    ))}
                  </ChipGroup>
                ) : null}
                <ChipGroup label="Where is the work?">
                  <ChoiceChip label="In person" active={!remote} onPress={() => setRemote(false)} />
                  <ChoiceChip label="Remote" active={remote} onPress={() => setRemote(true)} />
                </ChipGroup>
                <TextField
                  label={remote ? 'Area (optional)' : 'Where?'}
                  value={area}
                  onChangeText={setArea}
                  placeholder="e.g. Peradeniya town"
                  maxLength={80}
                />
                <TextField
                  label="Hours (optional)"
                  value={hours}
                  onChangeText={setHours}
                  placeholder="e.g. Weekends, 4 hours"
                  maxLength={60}
                />
                <ChipGroup label="Apply by">
                  <ChoiceChip label="No closing day" active={!closesOn} onPress={() => setClosesOn(null)} />
                  {closing.map((d) => (
                    <ChoiceChip
                      key={isoDay(d)}
                      label={dayMonth(d)}
                      active={closesOn === isoDay(d)}
                      onPress={() => setClosesOn(isoDay(d))}
                    />
                  ))}
                </ChipGroup>
                <TextField
                  label="Phone (optional)"
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="07X XXX XXXX"
                  keyboardType="phone-pad"
                  maxLength={20}
                  hint="Shown with a Call button. Leave empty to be messaged in the app instead."
                />
                <Text style={styles.hint}>
                  Every job shows “Never pay to get a job”. Posts that ask students for money to start work are removed.
                </Text>
              </>
            ) : null}

            <View style={styles.group}>
              {kind === 'bodim' || kind === 'lost_found' || kind === 'job' ? (
                <Text style={styles.label}>{kind === 'lost_found' ? 'Describe it' : 'More about it'}</Text>
              ) : null}
              <TextInput
                ref={input}
                value={body}
                onChangeText={setBody}
                placeholder={PLACEHOLDER[kind]}
                placeholderTextColor={theme.textMuted}
                multiline
                maxLength={MAX_LENGTH}
                style={[
                  styles.input,
                  kind === 'question' && styles.questionInput,
                  (kind === 'bodim' || kind === 'lost_found' || kind === 'job') && styles.boxedInput,
                ]}
                accessibilityLabel="Post text"
                textAlignVertical="top"
              />
              {left < 100 ? <Text style={styles.counter}>{left} characters left</Text> : null}
            </View>

            {photos.length > 0 || editing?.photos.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
                {editing?.photos.map((p) => (
                  <Image key={p.id} source={{ uri: photoUrl(p.id) ?? undefined }} style={styles.thumb} contentFit="cover" />
                ))}
                {photos.map((p, i) => (
                  <View key={p.uri} style={styles.thumbWrap}>
                    <Image source={{ uri: p.uri }} style={styles.thumb} contentFit="cover" />
                    <PressableScale
                      onPress={() => setPhotos((all) => all.filter((_, n) => n !== i))}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove photo ${i + 1}`}
                      hitSlop={8}
                      style={styles.remove}>
                      <XIcon size={14} weight="bold" color="#fff" />
                    </PressableScale>
                  </View>
                ))}
              </ScrollView>
            ) : null}
            {editing?.photos.length ? (
              <Text style={styles.hint}>Photos cannot be changed. Delete the post to post new ones.</Text>
            ) : null}
            {kind === 'bodim' && !editing && photos.length === 0 ? (
              <Text style={styles.hint}>Add photos of the room and the outside: places with photos get far more messages.</Text>
            ) : null}

            <ChipGroup label="Who sees it">
              <ChoiceChip label="My uni" active={!everyone} onPress={() => setEveryone(false)} />
              <ChoiceChip label="All unis" active={everyone} onPress={() => setEveryone(true)} />
            </ChipGroup>
            <Text style={[styles.hint, { marginTop: -space.md }]}>
              {everyone
                ? 'Students at every university can see it, with your university next to your name.'
                : 'Only students at your university see it.'}
            </Text>
            <FormMessage message={error} />
          </View>
        </KeyboardScroll>

        <View style={styles.bar}>
          {editing ? null : (
            <PressableScale
              onPress={addPhotos}
              disabled={photos.length >= MAX_PHOTOS || sending || preparing}
              accessibilityRole="button"
              accessibilityLabel={`Add photos, ${photos.length} of ${MAX_PHOTOS}`}
              hitSlop={6}
              style={[styles.photoButton, photos.length >= MAX_PHOTOS && styles.disabled]}>
              <ImageIcon size={24} color={look?.solid ?? theme.accentText} />
              <Text style={[styles.photoText, { color: look?.text ?? theme.accentText }]}>
                {preparing ? 'Preparing…' : photos.length ? `${photos.length}/${MAX_PHOTOS}` : 'Photos'}
              </Text>
            </PressableScale>
          )}
          <View style={styles.flex}>
            <Button
              label={
                progress !== null
                  ? `Uploading ${Math.round(progress * 100)}%`
                  : editing
                    ? 'Save'
                    : kind === 'bodim'
                      ? 'List bodim'
                      : kind === 'job'
                        ? 'Post job'
                        : kind === 'question'
                          ? 'Ask'
                          : 'Post'
              }
              onPress={send}
              loading={sending && progress === null}
              disabled={sending || preparing}
            />
          </View>
        </View>
      </KeyboardFrame>
    </Screen>
  );
}

function KindTile({ look, label, active, onPress }: { look: Look | null; label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  const styles = useStyles();
  const solid = look?.solid ?? theme.text;
  const Icon = look?.Icon ?? ChatTeardropTextIcon;
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={[
        styles.tile,
        { borderColor: active ? solid : theme.border },
        active && { backgroundColor: look?.solid ?? theme.text },
        !active && look && { backgroundColor: look.tint, borderColor: look.tint },
      ]}>
      <Icon
        size={22}
        weight={active ? 'fill' : 'bold'}
        color={active ? (look?.onSolid ?? theme.background) : (look?.text ?? theme.text)}
      />
      <Text
        style={[styles.tileText, { color: active ? (look?.onSolid ?? theme.background) : (look?.text ?? theme.text) }]}
        numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  flex: { flex: 1 },
  content: { padding: space.xl, paddingTop: space.sm },
  stack: { gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  kinds: { gap: space.sm, paddingRight: space.xl },
  tile: {
    width: 96,
    height: 80,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    padding: space.sm + 2,
    justifyContent: 'space-between',
  },
  tileText: { fontFamily: fonts.bodyBold, fontSize: 14 },
  split: { flexDirection: 'row', gap: space.sm },
  bigChoice: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 52,
    borderRadius: radius.lg,
    borderWidth: 1.5,
  },
  bigChoiceText: { fontFamily: fonts.bodyBold, fontSize: 16 },
  input: { minHeight: 120, fontFamily: fonts.body, fontSize: 17, lineHeight: 24, color: t.text, padding: 0 },
  questionInput: { fontFamily: fonts.bodyBold, fontSize: 19, lineHeight: 26 },
  boxedInput: {
    minHeight: 96,
    fontSize: 16,
    backgroundColor: t.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  counter: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  photos: { gap: space.sm },
  thumbWrap: { width: 96, height: 96 },
  thumb: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: t.surface },
  remove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  group: { gap: space.sm },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  hint: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.textMuted },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: t.border,
    backgroundColor: t.background,
  },
  photoButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: space.xs },
  photoText: { fontFamily: fonts.bodyBold, fontSize: 14 },
  disabled: { opacity: 0.4 },
}));
