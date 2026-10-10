import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import { layoutGlide, riseIn } from '@/theme/motion';

/** Whether Reveals inside this tree play their entrance. Screens turn it on only for the first
 *  screen of a launch; switching screens is a plain crossfade with everything already in place. */
export const EntranceContext = createContext(false);

type Props = {
  /** Position in reading order; later items arrive a little later. */
  order: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

// How long to wait before layout changes glide. Until then the screen is still settling (safe-area
// insets, keyboard, centring), and those first adjustments must not animate.
const SETTLE_MS = 600;

// Rises into place on mount (first screen only), then glides when content above it changes size,
// e.g. when an error message appears. Reduced motion and web (pre-rendered pages): no motion.
export function Reveal({ order, children, style }: Props) {
  const playEntrance = use(EntranceContext);
  const reduceMotion = useReducedMotion();
  const still = reduceMotion || Platform.OS === 'web';
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (still) return;
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [still]);

  return (
    <Animated.View
      entering={!still && playEntrance ? riseIn(order) : undefined}
      layout={!still && settled ? layoutGlide : undefined}
      style={style}>
      {children}
    </Animated.View>
  );
}
