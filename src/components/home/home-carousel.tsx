import { useFocusEffect } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, FlatList, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { AdSlideView } from '@/components/home/ad-slide';
import { BrandCard } from '@/components/home/brand-card';
import { AD_RATIO, adSeen, cachedAds, loadHomeAds, type AdSlide } from '@/lib/ads';
import { createThemedStyles, radius, space } from '@/theme/tokens';

const PHOTO_MS = 6000;
const VIDEO_MS = 10000;

type Slide = { key: 'brand' } | { key: string; ad: AdSlide };

// The card at the top of Home: "you're in your uni era" first, then sponsored slides, moving on by
// themselves (6 seconds a photo, 10 a video). Touching it stops the motion while you swipe; it does
// not move at all with a screen reader or reduced motion on, when Home is not showing, or with the
// app in the background. With no ads it is just the brand card. Ads are the standard 1.91:1 size; the
// brand card grows to match, so every slide is the same height.
export const HomeCarousel = memo(function HomeCarousel({ assemble }: { assemble: boolean }) {
  const styles = useStyles();
  const reduceMotion = useReducedMotion();
  const list = useRef<FlatList<Slide>>(null);
  const [ads, setAds] = useState<AdSlide[]>(cachedAds);
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const [focused, setFocused] = useState(true);
  const [foreground, setForeground] = useState(true);
  const [screenReader, setScreenReader] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      loadHomeAds().then((next) => next && setAds(next));
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
    const reader = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    const app = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => {
      reader.remove();
      app.remove();
    };
  }, []);

  const slides = useMemo<Slide[]>(() => [{ key: 'brand' }, ...ads.map((ad) => ({ key: ad.id, ad }))], [ads]);
  const count = slides.length;
  const current = Math.min(index, count - 1);
  const adHeight = Math.round(width / AD_RATIO);
  const moving = count > 1 && width > 0 && !held && focused && foreground && !screenReader && !reduceMotion;

  // Counts the ad on screen as seen.
  useEffect(() => {
    const slide = slides[current];
    if (focused && 'ad' in slide) adSeen(slide.ad.id);
  }, [current, focused, slides]);

  // Moves on to the next slide (back to the first after the last).
  useEffect(() => {
    if (!moving) return;
    const slide = slides[current];
    const timer = setTimeout(
      () => {
        const next = (current + 1) % count;
        list.current?.scrollToOffset({ offset: next * width, animated: next !== 0 });
        setIndex(next);
      },
      'ad' in slide && slide.ad.media_kind === 'video' ? VIDEO_MS : PHOTO_MS,
    );
    return () => clearTimeout(timer);
  }, [moving, current, count, width, slides]);

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width > 0) setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
    setHeld(false);
  };

  if (count === 1) return <BrandCard assemble={assemble} />;

  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <FlatList
          ref={list}
          horizontal
          pagingEnabled
          data={slides}
          keyExtractor={(s) => s.key}
          extraData={current}
          renderItem={({ item, index: i }) => (
            <View style={[styles.slide, { width }]}>
              {'ad' in item ? (
                <AdSlideView ad={item.ad} active={i === current && focused && foreground} />
              ) : (
                <BrandCard assemble={assemble} minHeight={adHeight} />
              )}
            </View>
          )}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          showsHorizontalScrollIndicator={false}
          onScrollBeginDrag={() => setHeld(true)}
          onMomentumScrollEnd={settle}
          onScrollEndDrag={(e) => {
            // A drag that does not fling still settles on a page.
            if (Math.abs(e.nativeEvent.velocity?.x ?? 0) < 0.05) settle(e);
          }}
          initialNumToRender={2}
          windowSize={3}
          accessibilityRole="adjustable"
          accessibilityLabel={`Slide ${current + 1} of ${count}`}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => {
            const next = Math.max(0, Math.min(count - 1, current + (e.nativeEvent.actionName === 'increment' ? 1 : -1)));
            list.current?.scrollToOffset({ offset: next * width, animated: false });
            setIndex(next);
          }}
        />
      ) : (
        <BrandCard assemble={assemble} />
      )}
      <View style={styles.dots} importantForAccessibility="no-hide-descendants">
        {slides.map((s, i) => (
          <View key={s.key} style={[styles.dot, i === current && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
});

const useStyles = createThemedStyles((t) => ({
  wrap: { gap: space.sm },
  // With very large text the brand card can be taller than an ad; the ads then sit in the middle.
  slide: { justifyContent: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: t.borderFilled },
  dotActive: { width: 18, backgroundColor: t.accentText },
}));
