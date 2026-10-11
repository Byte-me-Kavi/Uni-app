import { useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

type Listenable = {
  addListener: (event: 'transitionEnd', callback: (e: { data?: { closing?: boolean } }) => void) => () => void;
};

// Fallback for when no transition event comes (web, or a screen shown without animation).
const FALLBACK_MS = 450;

/**
 * Whether the screen has finished sliding in. Work that would add rows or views while the screen
 * is still moving (server refreshes, hidden sheets) waits for this, so the slide stays smooth.
 * `whenSettled` resolves at the same moment, for code outside React.
 *
 * `shown` is false while the screen is only prepared in the background (preloaded): the fallback
 * timer starts once it is actually shown.
 */
export function useSettled(shown = true) {
  const navigation = useNavigation() as unknown as Listenable;
  const [settled, setSettled] = useState(false);
  const gate = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  if (!gate.current) {
    let resolve = () => {};
    const promise = new Promise<void>((r) => (resolve = r));
    gate.current = { promise, resolve };
  }

  useEffect(() => {
    if (!shown) return;
    const done = () => {
      gate.current?.resolve();
      setSettled(true);
    };
    const unsubscribe = navigation.addListener('transitionEnd', (e) => {
      if (!e.data?.closing) done();
    });
    const timer = setTimeout(done, FALLBACK_MS);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [navigation, shown]);

  return { settled, whenSettled: gate.current.promise };
}
