import { Platform, Text } from 'react-native';
import Animated, {
  Easing,
  FadeOut,
  useReducedMotion,
  withTiming,
  type EntryAnimationsValues,
} from 'react-native-reanimated';

import { layoutGlide } from '@/theme/motion';
import { createThemedStyles, fonts, radius, space } from '@/theme/tokens';

type Props = { message: string | null; tone?: 'error' | 'info' };

// Drops in from just above its final spot, so it reads as attached to the form it belongs to.
function dropIn(_values: EntryAnimationsValues) {
  'worklet';
  const easing = Easing.bezier(0.23, 1, 0.32, 1);
  return {
    initialValues: { opacity: 0, transform: [{ translateY: -6 }] },
    animations: {
      opacity: withTiming(1, { duration: 200, easing }),
      transform: [{ translateY: withTiming(0, { duration: 260, easing }) }],
    },
  };
}

export function FormMessage({ message, tone = 'error' }: Props) {
  const styles = useStyles();
  const reduceMotion = useReducedMotion();
  if (!message) return null;
  // Reduced motion and web (pre-rendered pages) get no entrance; it simply appears.
  const still = reduceMotion || Platform.OS === 'web';
  const error = tone === 'error';
  return (
    <Animated.View
      entering={still ? undefined : dropIn}
      exiting={still ? undefined : FadeOut.duration(140)}
      layout={still ? undefined : layoutGlide}
      style={[styles.box, error ? styles.error : styles.info]}
      accessibilityRole={error ? 'alert' : 'text'}
      accessibilityLiveRegion="assertive">
      <Text style={[styles.text, error ? styles.errorText : styles.infoText]}>{message}</Text>
    </Animated.View>
  );
}

const useStyles = createThemedStyles((t) => ({
  box: { borderRadius: radius.md, paddingVertical: space.md, paddingHorizontal: space.lg },
  error: { backgroundColor: t.errorBg },
  info: { backgroundColor: t.infoBg },
  text: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 21 },
  errorText: { color: t.errorText },
  infoText: { color: t.infoText },
}));
