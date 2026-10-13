import { Image } from 'expo-image';
import { createElement, memo, useEffect, useState, type ComponentType } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PlayIcon } from 'phosphor-react-native/src/icons/Play';

import { PressableScale } from '@/components/ui/pressable-scale';
import { AD_RATIO, adMedia, onWifi, openAd, type AdPlacement, type AdSlide as Ad } from '@/lib/ads';
import { hasNative } from '@/lib/native';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// The video player is loaded only on app builds that have it; older builds show the cover image.
let VideoComponent: ComponentType<{ uri: string; playing: boolean }> | null | undefined;
function videoPlayer() {
  if (VideoComponent === undefined) {
    VideoComponent = hasNative('ExpoVideo')
      ? (require('./ad-video') as { default: ComponentType<{ uri: string; playing: boolean }> }).default
      : null;
  }
  return VideoComponent;
}

// One sponsored slide on Home at the standard 1.91:1 ad size: the photo, GIF or video filling it and
// "Sponsored · <sponsor>" always visible. Ready-made ads (text already in the image) show uncovered,
// with only a small button in the corner when there is a link; a headline or text, if the admin adds
// one, sits on a dark band at the bottom (white on it, so it reads over any image). Tapping opens the
// sponsor's link.
// Videos play muted while their slide is showing, by themselves on Wi-Fi; on mobile data the cover
// shows with a play button, so students choose to spend data on them.
export const AdSlideView = memo(function AdSlideView({
  ad,
  active,
  preview = false,
  bare = false,
  placement = 'home',
}: {
  ad: Ad;
  active: boolean;
  /** The feed: the media only (the feed card shows who it is from and the text around it). */
  bare?: boolean;
  placement?: AdPlacement;
  /** The admin's preview: no link, no counting. */
  preview?: boolean;
}) {
  const styles = useStyles();
  const video = ad.media_kind === 'video';
  const Player = video ? videoPlayer() : null;
  const [wifi, setWifi] = useState(false);
  const [chosen, setChosen] = useState(false);

  useEffect(() => {
    if (!video || !active) return;
    let live = true;
    onWifi().then((on) => live && setWifi(on));
    return () => {
      live = false;
    };
  }, [video, active]);

  const playing = !!Player && active && (wifi || chosen || preview);
  const cover = video ? ad.poster_path : ad.media_path;
  const hasText = !!(ad.headline || ad.body);
  const label = [ad.headline, ad.body, `Sponsored by ${ad.sponsor}`].filter(Boolean).join('. ');

  return (
    <PressableScale
      onPress={() => (preview ? undefined : openAd(ad, placement))}
      disabled={preview || !ad.link_url}
      accessibilityRole={ad.link_url ? 'link' : 'image'}
      accessibilityLabel={label}
      accessibilityHint={ad.link_url ? 'Opens the sponsor’s page' : undefined}
      scale={0.99}
      style={styles.card}>
      <Image
        source={cover ? { uri: adMedia(cover) ?? undefined } : null}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={150}
        autoplay={active}
      />
      {Player && video && playing ? createElement(Player, { uri: adMedia(ad.media_path) ?? '', playing }) : null}

      {bare ? null : (
        <View style={styles.sponsor}>
          <Text style={styles.sponsorText} numberOfLines={1}>
            Sponsored · {ad.sponsor}
          </Text>
        </View>
      )}

      {video && Player && !playing ? (
        <PressableScale
          onPress={() => setChosen(true)}
          accessibilityRole="button"
          accessibilityLabel="Play video"
          hitSlop={8}
          style={styles.play}>
          <PlayIcon size={22} weight="fill" color={brand.ink} />
        </PressableScale>
      ) : null}

      {bare ? null : hasText ? (
        <View style={styles.band}>
          <View style={styles.copy}>
            {ad.headline ? (
              <Text style={styles.headline} numberOfLines={1}>
                {ad.headline}
              </Text>
            ) : null}
            {ad.body ? (
              <Text style={styles.body} numberOfLines={ad.headline ? 1 : 2}>
                {ad.body}
              </Text>
            ) : null}
          </View>
          {ad.cta_label ? <Cta label={ad.cta_label} /> : null}
        </View>
      ) : ad.cta_label ? (
        <View style={styles.corner}>
          <Cta label={ad.cta_label} />
        </View>
      ) : null}
    </PressableScale>
  );
});

function Cta({ label }: { label: string }) {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <View style={[styles.cta, { backgroundColor: theme.accent }]}>
      <Text style={[styles.ctaText, { color: theme.onAccent }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  card: {
    width: '100%',
    aspectRatio: AD_RATIO,
    borderRadius: radius.lg + 6,
    overflow: 'hidden',
    backgroundColor: t.surface,
    justifyContent: 'flex-end',
  },
  // Always readable over the media: white pill, Ink text.
  sponsor: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    maxWidth: '70%',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  sponsorText: { fontFamily: fonts.bodyBold, fontSize: 11, color: brand.ink },
  play: {
    position: 'absolute',
    top: '50%',
    marginTop: -24,
    alignSelf: 'center',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: 'rgba(0,0,0,0.58)',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  copy: { flex: 1, gap: 1 },
  headline: { fontFamily: fonts.bodyBold, fontSize: 15, color: brand.white },
  body: { fontFamily: fonts.bodySemiBold, fontSize: 13, lineHeight: 17, color: 'rgba(255,255,255,0.88)' },
  corner: { position: 'absolute', right: space.sm, bottom: space.sm },
  cta: { borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: 32, justifyContent: 'center', maxWidth: 140 },
  ctaText: { fontFamily: fonts.bodyBold, fontSize: 13 },
}));
