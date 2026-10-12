import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Switch, Text, View } from 'react-native';

import { AdSlideView } from '@/components/home/ad-slide';
import { ChoiceChip } from '@/components/shop/choice-chip';
import { ActionSheet } from '@/components/ui/action-sheet';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { KeyboardFrame, KeyboardScroll } from '@/components/ui/keyboard';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { AD_RATIO, deleteAd, loadAdminAds, pickAdMedia, saveAd, uploadAdFile, type AdminAds, type AdSlide } from '@/lib/ads';
import { weekdayDayMonth } from '@/lib/dates';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Media = { uri?: string; path?: string; mime?: string; kind: 'image' | 'video' };

const PRIORITIES = [
  { value: 0, label: 'Normal' },
  { value: 30, label: 'High' },
  { value: 70, label: 'Top' },
];
const DAY_CHIP = 112;
const dayLayout = (_: unknown, index: number) => ({ length: DAY_CHIP, offset: (DAY_CHIP + space.sm) * index, index });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const days = (from: number, count: number) => {
  const today = startOfDay(new Date());
  return Array.from({ length: count }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + from + i));
};
const START_DAYS = days(1, 60);
const END_DAYS = days(1, 120);

// Admins: one ad on Home. A photo, GIF or video (with a cover), who it is from, optional headline,
// text and link button, where it shows, when it runs and how high it sits. The preview at the top
// is the real slide, as students will see it.
export default function AdminAdScreen() {
  const theme = useTheme();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [setup, setSetup] = useState<AdminAds | null>(null);
  const [media, setMedia] = useState<Media | null>(null);
  const [poster, setPoster] = useState<Media | null>(null);
  const [name, setName] = useState('');
  const [sponsor, setSponsor] = useState('');
  const [headline, setHeadline] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [cta, setCta] = useState('');
  const [institution, setInstitution] = useState<number | null | undefined>(undefined);
  // null: now (start) / no end date. Otherwise the chosen day (ISO); the time is kept on edits.
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [priority, setPriority] = useState(0);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let live = true;
    loadAdminAds().then((r) => {
      if (!live) return;
      if (!r.data) return setError(r.error);
      setSetup(r.data);
      const ad = id ? r.data.ads.find((a) => a.id === id) : null;
      if (ad) {
        setMedia({ path: ad.media_path, kind: ad.media_kind });
        setPoster(ad.poster_path ? { path: ad.poster_path, kind: 'image' } : null);
        setName(ad.name);
        setSponsor(ad.sponsor);
        setHeadline(ad.headline ?? '');
        setBody(ad.body ?? '');
        setLink(ad.link_url ?? '');
        setCta(ad.cta_label ?? '');
        setInstitution(ad.institution_id);
        setStartsAt(ad.starts_at);
        setEndsAt(ad.ends_at);
        setPriority(ad.priority);
        setActive(ad.active);
      } else {
        // National admins default to every university; others to their own.
        setInstitution(r.data.national ? null : (r.data.universities[0]?.id ?? null));
      }
    });
    return () => {
      live = false;
    };
  }, [id]);

  async function choose(kind: 'media' | 'poster') {
    setError(null);
    const r = await pickAdMedia(kind);
    if (!r) return;
    if ('error' in r) return setError(r.error);
    const picked = { uri: r.uri, mime: r.mime, kind: r.kind };
    if (kind === 'media') {
      setMedia(picked);
      if (r.kind === 'image') setPoster(null);
    } else setPoster(picked);
  }

  async function save() {
    setError(null);
    if (!media) return setError('Add a photo, GIF or video.');
    if (media.kind === 'video' && !poster) return setError('Add a cover image for the video.');
    if (sponsor.trim().length < 2) return setError('Enter who the ad is from.');
    if (link.trim() && !/^https:\/\/\S+$/.test(link.trim())) return setError('The link must start with https://');
    setSaving(true);
    let mediaPath = media.path;
    if (!mediaPath && media.uri && media.mime) {
      setProgress(media.kind === 'video' ? 'Uploading the video…' : 'Uploading the photo…');
      const up = await uploadAdFile('media', { uri: media.uri, mime: media.mime }, (share) =>
        setProgress(`Uploading… ${Math.round(share * 100)}%`),
      );
      if ('error' in up) {
        setSaving(false);
        setProgress(null);
        return setError(up.error);
      }
      mediaPath = up.path;
      setMedia({ ...media, path: up.path });
    }
    let posterPath = media.kind === 'video' ? (poster?.path ?? null) : null;
    if (media.kind === 'video' && !posterPath && poster?.uri && poster.mime) {
      setProgress('Uploading the cover…');
      const up = await uploadAdFile('poster', { uri: poster.uri, mime: poster.mime });
      if ('error' in up) {
        setSaving(false);
        setProgress(null);
        return setError(up.error);
      }
      posterPath = up.path;
      setPoster({ ...poster, path: up.path });
    }
    setProgress(null);
    const r = await saveAd(id ?? null, {
      name: name.trim() || `${sponsor.trim()} ${new Date().toLocaleDateString()}`,
      sponsor: sponsor.trim(),
      headline: headline.trim(),
      body: body.trim(),
      cta_label: cta.trim(),
      link_url: link.trim(),
      media_kind: media.kind,
      media_path: mediaPath!,
      poster_path: posterPath,
      institution_id: institution ?? null,
      starts_at: startsAt ?? new Date().toISOString(),
      ends_at: endsAt,
      priority,
      active,
    });
    setSaving(false);
    if (r.error) return setError(r.error);
    router.back();
  }

  if (!setup) {
    return (
      <Screen style={styles.screen}>
        <BackHeader title={id ? 'Edit ad' : 'New ad'} />
        <View style={styles.center}>
          {error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} />}
        </View>
      </Screen>
    );
  }

  const preview: AdSlide = {
    id: id ?? 'preview',
    sponsor: sponsor.trim() || 'Sponsor',
    headline: headline.trim() || null,
    body: body.trim() || null,
    cta_label: link.trim() ? cta.trim() || 'Learn more' : null,
    link_url: link.trim() || null,
    media_kind: media?.kind ?? 'image',
    media_path: media?.uri ?? media?.path ?? '',
    poster_path: poster?.uri ?? poster?.path ?? null,
  };
  const startChoice = startsAt ? startOfDay(new Date(startsAt)).getTime() : null;
  const endChoice = endsAt ? startOfDay(new Date(endsAt)).getTime() : null;

  return (
    <Screen style={styles.screen}>
      <BackHeader title={id ? 'Edit ad' : 'New ad'} />
      <KeyboardFrame style={styles.flex}>
        <KeyboardScroll contentContainerStyle={styles.content}>
          <View style={styles.stack}>
            <Group label="Preview">
              {media ? (
                <AdSlideView ad={preview} active preview />
              ) : (
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>Your photo, GIF or video shows here, as it will on Home.</Text>
                </View>
              )}
            </Group>

            <Group label="Photo, GIF or video">
              <Button
                label={media ? 'Change photo or video' : 'Choose photo or video'}
                variant={media ? 'quiet' : 'primary'}
                onPress={() => choose('media')}
              />
              <Text style={styles.hint}>
                Use the standard landscape ad size, 1200 × 628 (1.91:1), the same as Google and Facebook link ads, so an existing
                ad fits as it is. 16:9 videos work too, with a thin strip trimmed off the top and bottom. Photos and GIFs up to 5
                MB; videos MP4 or MOV, up to 25 MB, under 30 seconds. Videos play muted, by themselves only on Wi-Fi.
              </Text>
            </Group>
            {media?.kind === 'video' ? (
              <Group label="Cover image">
                <Button
                  label={poster ? 'Change cover' : 'Choose cover'}
                  variant={poster ? 'quiet' : 'primary'}
                  onPress={() => choose('poster')}
                />
                <Text style={styles.hint}>Shown before the video plays, on mobile data and on older app versions.</Text>
              </Group>
            ) : null}

            <TextField
              label="Sponsor"
              value={sponsor}
              onChangeText={setSponsor}
              placeholder="e.g. Dialog"
              maxLength={60}
              hint="Shown on the ad as “Sponsored · Dialog”."
            />
            <TextField
              label="Headline (optional)"
              hint="Leave headline and text empty if the image already has its own words; they show on a band over its bottom."
              value={headline}
              onChangeText={setHeadline}
              placeholder="e.g. Unlimited study data"
              maxLength={60}
            />
            <TextField
              label="Text (optional)"
              value={body}
              onChangeText={setBody}
              placeholder="e.g. Rs 499 a month with your student email."
              multiline
              maxLength={140}
            />
            <TextField
              label="Link (optional)"
              value={link}
              onChangeText={setLink}
              placeholder="https://"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              hint="Opens when a student taps the ad. https only."
            />
            {link.trim() ? (
              <TextField label="Button" value={cta} onChangeText={setCta} placeholder="Learn more" maxLength={24} />
            ) : null}

            <Group label="Where it shows">
              <View style={styles.chips}>
                {setup.national ? (
                  <ChoiceChip label="All universities" active={institution === null} onPress={() => setInstitution(null)} />
                ) : null}
                {setup.universities.map((u) => (
                  <ChoiceChip
                    key={u.id}
                    label={u.short_name ?? u.name}
                    active={institution === u.id}
                    onPress={() => setInstitution(u.id)}
                  />
                ))}
              </View>
            </Group>

            <Group label="Starts">
              <FlatList
                horizontal
                data={[null, ...START_DAYS]}
                keyExtractor={(d) => (d ? String(d.getTime()) : 'now')}
                extraData={startChoice}
                renderItem={({ item }) => (
                  <ChoiceChip
                    width={DAY_CHIP}
                    label={item ? weekdayDayMonth(item) : startsAt && id ? 'Unchanged' : 'Now'}
                    active={
                      item ? startChoice === item.getTime() : !startsAt || !START_DAYS.some((d) => d.getTime() === startChoice)
                    }
                    onPress={() => setStartsAt(item ? item.toISOString() : id ? startsAt : null)}
                  />
                )}
                getItemLayout={dayLayout}
                initialNumToRender={5}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.row}
              />
            </Group>
            <Group label="Ends">
              <FlatList
                horizontal
                data={[null, ...END_DAYS]}
                keyExtractor={(d) => (d ? String(d.getTime()) : 'none')}
                extraData={endChoice}
                renderItem={({ item }) => (
                  <ChoiceChip
                    width={DAY_CHIP}
                    label={item ? weekdayDayMonth(item) : 'No end date'}
                    active={item ? endChoice === item.getTime() : !endsAt}
                    // The end of that day.
                    onPress={() =>
                      setEndsAt(item ? new Date(item.getFullYear(), item.getMonth(), item.getDate(), 23, 59).toISOString() : null)
                    }
                  />
                )}
                getItemLayout={dayLayout}
                initialNumToRender={5}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.row}
              />
            </Group>

            <Group label="Priority">
              <View style={styles.chips}>
                {PRIORITIES.map((p) => (
                  <ChoiceChip key={p.value} label={p.label} active={priority === p.value} onPress={() => setPriority(p.value)} />
                ))}
              </View>
              <Text style={styles.hint}>Higher shows first. Up to 6 ads show at a time.</Text>
            </Group>

            <View style={styles.switchRow}>
              <View style={styles.flex}>
                <Text style={styles.label}>Show it</Text>
                <Text style={styles.hint}>Turn off to pause without deleting.</Text>
              </View>
              <Switch
                value={active}
                onValueChange={setActive}
                trackColor={{ true: theme.accent, false: theme.borderFilled }}
                accessibilityLabel="Show this ad"
              />
            </View>

            <TextField
              label="Name for your list (optional)"
              value={name}
              onChangeText={setName}
              placeholder="e.g. Dialog student pack, October"
              maxLength={80}
            />

            {progress ? <FormMessage message={progress} tone="info" /> : null}
            <FormMessage message={error} />
            <Button label={id ? 'Save changes' : 'Publish ad'} loading={saving} onPress={save} />
            {id ? <Button label="Delete ad" variant="quiet" onPress={() => setConfirmDelete(true)} /> : null}
          </View>
        </KeyboardScroll>
      </KeyboardFrame>
      <ActionSheet
        visible={confirmDelete}
        title="Delete this ad?"
        message="It leaves Home at once, with its numbers. To stop it for now, turn off Show it instead."
        actions={[
          {
            label: 'Delete',
            destructive: true,
            onPress: async () => {
              const r = await deleteAd(id!);
              if (r.error) setError(r.error);
              else router.back();
            },
          },
        ]}
        onClose={() => setConfirmDelete(false)}
      />
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  flex: { flex: 1 },
  content: { padding: space.xl, paddingTop: space.sm, paddingBottom: space.xxxl },
  stack: { gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  group: { gap: space.sm },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  hint: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { gap: space.sm, paddingRight: space.xl },
  empty: {
    width: '100%',
    aspectRatio: AD_RATIO,
    borderRadius: radius.lg + 6,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: t.borderFilled,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  emptyText: { fontFamily: fonts.body, fontSize: 14, color: t.textMuted, textAlign: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
}));
