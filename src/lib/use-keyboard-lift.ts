import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, type View } from 'react-native';

// Android (and, for sheets, iPhone): keeps what is at the bottom of the screen (a caption box, a
// search field, a sheet with a text box) above the keyboard. Whether Android shrinks this window for the keyboard differs between phones, so this
// measures where the keyboard actually starts and lifts the content by exactly the overlap: zero
// when the window already made room, the keyboard's height when it did not.
const lifts = (iphoneToo: boolean) => Platform.OS === 'android' || (Platform.OS === 'ios' && iphoneToo);

export function useKeyboardLift(visible: boolean, iphoneToo = false) {
  const ref = useRef<View>(null);
  const keyboardTop = useRef<number | null>(null);
  const [overlap, setOverlap] = useState(0);

  const measure = () => {
    const top = keyboardTop.current;
    if (top === null) {
      setOverlap(0);
      return;
    }
    ref.current?.measureInWindow((_x, y, _w, height) => setOverlap(Math.max(0, Math.round(y + height - top))));
  };

  useEffect(() => {
    if (!lifts(iphoneToo) || !visible) return;
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      keyboardTop.current = e.endCoordinates.screenY;
      measure();
    });
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      keyboardTop.current = null;
      setOverlap(0);
    });
    return () => {
      show.remove();
      hide.remove();
      keyboardTop.current = null;
      setOverlap(0);
    };
  }, [visible, iphoneToo]);

  return { ref, measure, overlap };
}
