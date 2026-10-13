import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { AD_STATUS, adMedia, loadAdminAds, PLACEMENT_LABEL, type AdminAd, type AdminAds } from '@/lib/ads';
import { dayMonth } from '@/lib/dates';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

const NUMBER = new Intl.NumberFormat('en-US');

// Admins: the ads on Home, live ones first, with how many students saw and tapped each (counted
// once per student a day). New ad, or tap one to change, pause or delete it.
export default function AdminAdsScreen() {
  const theme = useTheme();
  const styles = useStyles();
  const [data, setData] = useState<AdminAds | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      loadAdminAds().then((r) => {
        if (!live) return;
        if (r.data) setData(r.data);
        setError(r.error);
      });
      return () => {
        live = false;
      };
    }, []),
  );

  const header = (
    <View style={styles.header}>
      <Text style={styles.intro}>
        {
          'Sponsored slides on the Home card (after “you’re in your uni era”) and between posts in the feed. Students always see who each is from.'
        }
      </Text>
      <Button label="New ad" onPress={() => router.push('/admin/ad')} />
      <FormMessage message={error} />
    </View>
  );

  if (!data) {
    return (
      <Screen style={styles.screen}>
        <BackHeader title="Ads" />
        <View style={styles.center}>
          {error ? <FormMessage message={error} /> : <ActivityIndicator color={theme.accentText} />}
        </View>
      </Screen>
    );
  }

  return (
    <Screen style={styles.screen}>
      <BackHeader title="Ads" />
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        data={data.ads}
        keyExtractor={(a) => a.id}
        ListHeaderComponent={header}
        ItemSeparatorComponent={Separator}
        renderItem={({ item }) => <AdRow ad={item} />}
        ListEmptyComponent={<Text style={styles.empty}>No ads yet. Home shows only the brand card until you add one.</Text>}
      />
    </Screen>
  );
}

function AdRow({ ad }: { ad: AdminAd }) {
  const styles = useStyles();
  const rate = ad.viewers > 0 ? `${((ad.taps / ad.viewers) * 100).toFixed(1)}%` : '–';
  return (
    <PressableScale
      onPress={() => router.push({ pathname: '/admin/ad', params: { id: ad.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${ad.name}, ${AD_STATUS[ad.status]}. ${ad.viewers} viewers, ${ad.taps} taps`}
      scale={0.985}
      style={styles.row}>
      <Image
        source={{ uri: adMedia(ad.media_kind === 'video' ? ad.poster_path : ad.media_path) ?? undefined }}
        style={styles.thumb}
        contentFit="cover"
        autoplay={false}
      />
      <View style={styles.copy}>
        <View style={styles.top}>
          <Text style={styles.name} numberOfLines={1}>
            {ad.name}
          </Text>
          <View style={[styles.pill, ad.status === 'live' && styles.pillLive]}>
            <Text style={[styles.pillText, ad.status === 'live' && styles.pillLiveText]}>{AD_STATUS[ad.status]}</Text>
          </View>
        </View>
        <Text style={styles.muted} numberOfLines={1}>
          {ad.sponsor} · {ad.university ?? 'All universities'} ·{' '}
          {(ad.placements ?? ['home']).map((p) => PLACEMENT_LABEL[p]).join(' + ')}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {dayMonth(ad.starts_at)} to {ad.ends_at ? dayMonth(ad.ends_at) : 'no end date'}
          {ad.priority ? ` · priority ${ad.priority}` : ''}
        </Text>
        <Text style={styles.numbers}>
          {NUMBER.format(ad.viewers)} viewers · {NUMBER.format(ad.taps)} taps · {rate}
        </Text>
        {(ad.placements ?? []).length > 1
          ? (['home', 'feed'] as const).map((p) => (
              <Text key={p} style={styles.muted}>
                {PLACEMENT_LABEL[p]}: {NUMBER.format(ad.by_placement?.[p]?.viewers ?? 0)} viewers,{' '}
                {NUMBER.format(ad.by_placement?.[p]?.taps ?? 0)} taps
              </Text>
            ))
          : null}
      </View>
    </PressableScale>
  );
}

function Separator() {
  const styles = useStyles();
  return <View style={styles.separator} />;
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  list: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center' },
  content: { padding: space.xl, paddingTop: space.sm, paddingBottom: space.xxxl },
  header: { gap: space.lg, marginBottom: space.lg },
  intro: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: t.textMuted },
  separator: { height: space.md },
  row: { flexDirection: 'row', gap: space.md, borderWidth: 1, borderColor: t.border, borderRadius: radius.lg, padding: space.md },
  thumb: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: t.surface },
  copy: { flex: 1, gap: 2 },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  name: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  muted: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  numbers: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: t.text, marginTop: 2 },
  pill: { borderRadius: radius.pill, paddingHorizontal: space.sm + 2, paddingVertical: 2, backgroundColor: t.surface },
  pillLive: { backgroundColor: t.accent },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.textMuted },
  pillLiveText: { color: t.onAccent },
  empty: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: t.textMuted,
    textAlign: 'center',
    paddingVertical: space.lg,
  },
}));
