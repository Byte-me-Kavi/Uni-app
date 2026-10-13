import { router } from 'expo-router';
import { memo } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { AdSlideView } from '@/components/home/ad-slide';
import { KuppiCard } from '@/components/resources/kuppi-card';
import { SharedRow } from '@/components/resources/shared-row';
import { ListingCard } from '@/components/shop/listing-card';
import { PressableScale } from '@/components/ui/pressable-scale';
import { openAd, type AdSlide } from '@/lib/ads';
import type { Kuppi } from '@/lib/kuppi';
import type { SharedFile } from '@/lib/shared';
import type { ListingCard as Listing } from '@/lib/shop';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// The cards the feed mixes in between posts: a sponsored post, new things in the shop, kuppi coming
// up in your modules and files just shared to them. Each says plainly what it is.

/** An ad marked "Show in feed": who it is from above, the creative uncovered, its words below. */
export const FeedAd = memo(function FeedAd({ ad, active, preview = false }: { ad: AdSlide; active: boolean; preview?: boolean }) {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <Text style={styles.sponsored} numberOfLines={1}>
        Sponsored by {ad.sponsor}
      </Text>
      <AdSlideView ad={ad} active={active} bare placement="feed" preview={preview} />
      {ad.headline || ad.body || ad.cta_label ? (
        <View style={styles.adFoot}>
          <View style={styles.flex}>
            {ad.headline ? (
              <Text style={styles.title} numberOfLines={2}>
                {ad.headline}
              </Text>
            ) : null}
            {ad.body ? (
              <Text style={styles.muted} numberOfLines={3}>
                {ad.body}
              </Text>
            ) : null}
          </View>
          {ad.cta_label && ad.link_url ? (
            <PressableScale
              onPress={() => (preview ? undefined : openAd(ad, 'feed'))}
              accessibilityRole="link"
              accessibilityLabel={`${ad.cta_label}, ${ad.sponsor}`}
              style={[styles.cta, { backgroundColor: theme.accent }]}>
              <Text style={[styles.ctaText, { color: theme.onAccent }]} numberOfLines={1}>
                {ad.cta_label}
              </Text>
            </PressableScale>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

/** New in the shop at your university: a row of listings to swipe through. */
export const ShopRow = memo(function ShopRow({ listings }: { listings: Listing[] }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <SectionHead title="New in the shop" action="See all" onPress={() => router.push('/shop')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shopRow}>
        {listings.map((l) => (
          <View key={l.id} style={styles.listing}>
            <ListingCard listing={l} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
});

/** Kuppi in your modules in the next 3 days. */
export const KuppiSoon = memo(function KuppiSoon({ kuppi }: { kuppi: Kuppi[] }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <SectionHead title="Kuppi coming up in your modules" action="All kuppi" onPress={() => router.push('/resources')} />
      {kuppi.map((k) => (
        <KuppiCard key={k.id} kuppi={k} />
      ))}
    </View>
  );
});

/** Files shared to your modules this week. */
export const FilesShared = memo(function FilesShared({ files }: { files: SharedFile[] }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <SectionHead title="Just shared in your modules" />
      <View style={styles.files}>
        {files.map((f) => (
          <SharedRow key={f.id} file={f} showModule />
        ))}
      </View>
    </View>
  );
});

function SectionHead({ title, action, onPress }: { title: string; action?: string; onPress?: () => void }) {
  const styles = useStyles();
  return (
    <View style={styles.head}>
      <Text style={styles.headTitle} accessibilityRole="header">
        {title}
      </Text>
      {action && onPress ? (
        <PressableScale onPress={onPress} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.headAction}>{action}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  flex: { flex: 1 },
  card: { borderWidth: 1, borderColor: t.border, borderRadius: radius.lg, padding: space.md, gap: space.sm },
  sponsored: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.textMuted },
  adFoot: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  muted: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.textMuted },
  cta: { borderRadius: radius.pill, paddingHorizontal: space.lg, minHeight: 40, justifyContent: 'center', maxWidth: 160 },
  ctaText: { fontFamily: fonts.bodyBold, fontSize: 14 },
  section: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  headTitle: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  headAction: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.accentText },
  shopRow: { gap: space.sm },
  listing: { width: 156 },
  files: { borderWidth: 1, borderColor: t.border, borderRadius: radius.lg, overflow: 'hidden' },
}));
