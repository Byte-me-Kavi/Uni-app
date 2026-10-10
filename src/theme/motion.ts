import { Easing, LinearTransition, withDelay, withTiming, type EntryAnimationsValues } from 'react-native-reanimated';

// One motion language for the whole app. Strong ease-out: movement starts immediately, so the UI
// feels like it is answering the user, then settles gently. Every animation here follows the
// system reduce-motion setting (Reanimated's default), which turns movement off.

export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

export const duration = {
  press: 110,
  release: 180,
  state: 180,
  enter: 460,
} as const;

// Siblings glide to their new position when something above them appears or disappears
// (an error message, a hint), instead of jumping.
export const layoutGlide = LinearTransition.duration(240).easing(EASE_OUT);

// Content rises into place in reading order. 45ms between items keeps it quick; the sequence
// guides the eye from heading to fields to the main button.
export function riseIn(order: number) {
  const delay = 40 + order * 45;
  return (_values: EntryAnimationsValues) => {
    'worklet';
    const easing = Easing.bezier(0.23, 1, 0.32, 1);
    return {
      initialValues: { opacity: 0, transform: [{ translateY: 14 }] },
      animations: {
        opacity: withDelay(delay, withTiming(1, { duration: 360, easing })),
        transform: [{ translateY: withDelay(delay, withTiming(0, { duration: 520, easing })) }],
      },
    };
  };
}
