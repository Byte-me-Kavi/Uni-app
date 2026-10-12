import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  Keyboard,
  Platform,
  ScrollView,
  TextInput,
  View,
  type KeyboardEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

// Keeping what you type above the keyboard, on every phone.
//
// The app draws edge to edge, so on many Android phones the window does not shrink for the keyboard
// and a field in the lower half of a form ended up behind it (React Native's KeyboardAvoidingView was
// only used on iPhone). Instead of trusting the window, these measure where the keyboard actually
// starts and work from that:
//
//   KeyboardScroll   a ScrollView for forms: adds room at the bottom for the keyboard (only the part
//                    that really covers it; nothing on phones that already made room), and scrolls
//                    the field being typed in to just above the keyboard, when the keyboard opens and
//                    whenever another field gets focus.
//   KeyboardFrame    a screen with a bar fixed under its scroll area (Post, Save): lifts the whole
//                    frame by the part the keyboard covers, so the bar stays above it.

const SHOW = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const HIDE = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
// Room between the field and the keyboard, so its hint or error under it shows too.
const MARGIN = 28;

/** Where the keyboard starts on screen (window coordinates), or null while it is closed. */
function useKeyboardTop(onShow?: (top: number) => void, onHide?: () => void) {
  const top = useRef<number | null>(null);
  const latest = useRef({ onShow, onHide });
  useEffect(() => {
    latest.current = { onShow, onHide };
  });
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const show = Keyboard.addListener(SHOW, (e: KeyboardEvent) => {
      top.current = e.endCoordinates.screenY;
      latest.current.onShow?.(e.endCoordinates.screenY);
    });
    const hide = Keyboard.addListener(HIDE, () => {
      top.current = null;
      latest.current.onHide?.();
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return top;
}

/** How much of a view the keyboard covers: its bottom edge minus where the keyboard starts. */
function covered(view: View | null, keyboardTop: number, done: (overlap: number) => void) {
  if (!view) return done(0);
  view.measureInWindow((_x, y, _w, height) => done(Math.max(0, Math.round(y + height - keyboardTop))));
}

const RevealContext = createContext<(() => void) | null>(null);

/** For text fields: call when focused, so the nearest KeyboardScroll shows them above the keyboard. */
export function useRevealOnFocus() {
  return useContext(RevealContext);
}

export function KeyboardScroll({
  ref,
  children,
  contentContainerStyle,
  onScroll,
  onLayout,
  ...props
}: ScrollViewProps & { ref?: Ref<ScrollView>; children?: ReactNode }) {
  const scroll = useRef<ScrollView | null>(null);
  const frame = useRef<View>(null);
  const offset = useRef(0);
  const [room, setRoom] = useState(0);

  const setRefs = useCallback(
    (node: ScrollView | null) => {
      scroll.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as { current: ScrollView | null }).current = node;
    },
    [ref],
  );

  // Scrolls the focused field (if it is in this scroll view) to just above the keyboard, or down
  // from under the top edge.
  const reveal = useCallback((keyboardTop: number | null) => {
    const input = TextInput.State.currentlyFocusedInput() as unknown as View | null;
    const view = frame.current;
    if (!input || !view || keyboardTop === null) return;
    view.measureInWindow((_sx, sy, _sw, sh) => {
      input.measureInWindow((_x, y, _w, h) => {
        if (h === 0) return;
        const visibleTop = sy + 8;
        const visibleBottom = Math.min(sy + sh, keyboardTop) - MARGIN;
        let delta = 0;
        // A tall field (a long description) that cannot fit: show its top.
        if (h > visibleBottom - visibleTop) delta = y - visibleTop;
        else if (y + h > visibleBottom) delta = y + h - visibleBottom;
        else if (y < visibleTop) delta = y - visibleTop;
        if (Math.abs(delta) > 1) scroll.current?.scrollTo({ y: Math.max(0, offset.current + delta), animated: true });
      });
    });
  }, []);

  const keyboardTop = useKeyboardTop(
    (top) =>
      covered(frame.current, top, (overlap) => {
        setRoom(overlap);
        // After the room is laid out, so there is somewhere to scroll to.
        setTimeout(() => reveal(top), Platform.OS === 'ios' ? 280 : 60);
      }),
    () => setRoom(0),
  );

  // A field that gets focus while the keyboard is already open (Next, or a tap on another field).
  const onFocusField = () => {
    setTimeout(() => reveal(keyboardTop.current), 30);
  };

  return (
    <RevealContext.Provider value={onFocusField}>
      <View ref={frame} style={{ flex: 1 }} collapsable={false}>
        <ScrollView
          ref={setRefs}
          keyboardShouldPersistTaps="handled"
          {...props}
          scrollEventThrottle={16}
          onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
            offset.current = e.nativeEvent.contentOffset.y;
            onScroll?.(e);
          }}
          onLayout={(e) => {
            onLayout?.(e);
            // The frame around it moved (a KeyboardFrame lifted it): measure again.
            const top = keyboardTop.current;
            if (top !== null) covered(frame.current, top, setRoom);
          }}
          contentContainerStyle={contentContainerStyle}>
          {children}
          {room > 0 ? <View style={{ height: room }} /> : null}
        </ScrollView>
      </View>
    </RevealContext.Provider>
  );
}

export function KeyboardFrame({ style, children }: { style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const frame = useRef<View>(null);
  const [lift, setLift] = useState(0);
  // Padding does not move the frame's own edges, so the lift is simply the part the keyboard covers.
  const keyboardTop = useKeyboardTop(
    (top) => covered(frame.current, top, setLift),
    () => setLift(0),
  );
  const padding = useMemo(() => ({ paddingBottom: lift }), [lift]);
  return (
    <View
      ref={frame}
      collapsable={false}
      style={[style, padding]}
      onLayout={() => {
        // Phones that also shrink the window: once it has, less (or nothing) is covered.
        const top = keyboardTop.current;
        if (top !== null) covered(frame.current, top, setLift);
      }}>
      {children}
    </View>
  );
}
