import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { brand } from '@/theme/tokens';

// The Uni Era mark: the u of uni wearing a graduation cap. Geometry measured from the brand board
// (it matches the artwork to within 1% of pixels). The tassel is the one red thing; on a red
// background it turns white. Master file: assets/brand/uni-era-mark.svg.
const VIEW_BOX = '57 57 873 881';
const ASPECT = 881 / 873;
const U = 'M180 417 A84.5 84.5 0 0 1 349 417 V625.5 A143.5 143.5 0 0 0 636 625.5 V417 A84.5 84.5 0 0 1 805 417 V625.5 A312.5 312.5 0 0 1 180 625.5 Z';
const BOARD = 'M493 57 L930 208 L493 358 L57 208 Z';
const CAP = 'M304 250 H682 V378.7 A497 497 0 0 1 304 378.7 Z';
const CORD = 'M493 208 L873 236';
const DROP = 'M873 236 V450';

// Where the tassel hangs from, and the middle of the cap, as fractions of the mark's box.
const TASSEL_PIVOT = { x: (873 - 57) / 873, y: (236 - 57) / 881 };
const CAP_CENTRE = { x: (493 - 57) / 873, y: (250 - 57) / 881 };

type Props = {
  /** Width in points; height follows the mark's proportions. */
  size: number;
  /** The u and the cap. */
  color: string;
  /** The tassel. Brand red, or white on a red background. */
  tasselColor?: string;
  /** assemble: the cap drops onto the u and the tassel swings (one brand moment per launch).
   *  waiting: the tassel sways slowly while something is pending. */
  motion?: 'assemble' | 'waiting';
};

export function UniEraMark({ size, color, tasselColor = brand.red, motion }: Props) {
  const height = size * ASPECT;
  const reduceMotion = useReducedMotion();
  // Web pages are pre-rendered, so the mark is shown already assembled there.
  const assemble = motion === 'assemble' && !reduceMotion && Platform.OS !== 'web';

  const uIn = useSharedValue(assemble ? 0 : 1);
  const capIn = useSharedValue(assemble ? 0 : 1);
  const swing = useSharedValue(assemble ? 22 : 0);

  useEffect(() => {
    const easing = Easing.bezier(0.23, 1, 0.32, 1);
    if (assemble) {
      uIn.value = withTiming(1, { duration: 420, easing });
      capIn.value = withDelay(220, withSpring(1, { duration: 650, dampingRatio: 0.62 }));
      // The tassel keeps the cap's momentum and swings to rest.
      swing.value = withDelay(420, withSpring(0, { duration: 1400, dampingRatio: 0.28 }));
    } else if (motion === 'waiting' && !reduceMotion) {
      const sway = Easing.inOut(Easing.sin);
      swing.value = withRepeat(
        withSequence(withTiming(7, { duration: 1300, easing: sway }), withTiming(-7, { duration: 1300, easing: sway })),
        -1,
        true,
      );
    }
  }, [assemble, motion, reduceMotion, uIn, capIn, swing]);

  const uStyle = useAnimatedStyle(() => ({
    opacity: uIn.value,
    transform: [{ translateY: (1 - uIn.value) * height * 0.06 }],
  }));
  const capStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, capIn.value * 2),
    transform: [{ translateY: (1 - capIn.value) * -height * 0.38 }, { rotate: `${(1 - capIn.value) * -12}deg` }],
  }));
  const tasselStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${swing.value}deg` }],
  }));

  const box = { width: size, height };

  return (
    <View style={box} accessible accessibilityRole="image" accessibilityLabel="Uni Era">
      <Animated.View style={[styles.layer, box, uStyle]}>
        <Svg width={size} height={height} viewBox={VIEW_BOX}>
          <Path d={U} fill={color} />
        </Svg>
      </Animated.View>
      <Animated.View
        style={[styles.layer, box, { transformOrigin: [CAP_CENTRE.x * size, CAP_CENTRE.y * height, 0] }, capStyle]}>
        <Svg width={size} height={height} viewBox={VIEW_BOX}>
          <Path d={CAP} fill={color} />
          <Path d={BOARD} fill={color} />
          <Path d={CORD} stroke={tasselColor} strokeWidth={26} strokeLinecap="round" fill="none" />
          <Circle cx={493} cy={208} r={32} fill={tasselColor} />
        </Svg>
        <Animated.View
          style={[
            styles.layer,
            box,
            { transformOrigin: [TASSEL_PIVOT.x * size, TASSEL_PIVOT.y * height, 0] },
            tasselStyle,
          ]}>
          <Svg width={size} height={height} viewBox={VIEW_BOX}>
            <Path d={DROP} stroke={tasselColor} strokeWidth={26} strokeLinecap="round" fill="none" />
            <Rect x={836} y={438} width={73} height={140} rx={30} fill={tasselColor} />
          </Svg>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, left: 0 },
});
