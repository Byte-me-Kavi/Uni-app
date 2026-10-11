import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

// Sheets and menus drawn as a layer over the whole app, instead of in React Native's Modal.
//
// On Android a Modal is a separate window, and on some phones (seen on a Redmi A5) its content is
// sized shorter than the screen: the dimmed backdrop and the sheet stopped above the bottom edge
// and the chat showed through underneath. The app's own root always fills the screen, edge to
// edge, so a layer there reaches the bottom on every phone. It also opens faster: no new window
// is created each time.
//
// <SheetHost /> sits once at the root of the app. <SheetModal> is used like Modal: what is inside
// it is drawn in the host while `visible` is true. Android's back button closes the top one.

type Entry = { id: number; node: ReactNode };

let entries: Entry[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function put(id: number, node: ReactNode) {
  const index = entries.findIndex((e) => e.id === id);
  entries = index < 0 ? [...entries, { id, node }] : entries.map((e) => (e.id === id ? { id, node } : e));
  emit();
}

function remove(id: number) {
  if (!entries.some((e) => e.id === id)) return;
  entries = entries.filter((e) => e.id !== id);
  emit();
}

/** Draws the open sheets above everything else. Rendered once, at the root of the app. */
export function SheetHost() {
  const open = useSyncExternalStore(subscribe, () => entries, () => entries);
  return (
    <>
      {open.map((entry) => (
        <View key={entry.id} style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {entry.node}
        </View>
      ))}
    </>
  );
}

type Props = {
  visible: boolean;
  /** Android back button (and anything else that should close it). */
  onRequestClose: () => void;
  /** After it has gone from the screen. */
  onDismiss?: () => void;
  children: ReactNode;
};

export function SheetModal({ visible, onRequestClose, onDismiss, children }: Props) {
  const id = useRef(0);
  if (!id.current) id.current = nextId++;
  const latest = useRef({ onRequestClose, onDismiss });
  latest.current = { onRequestClose, onDismiss };

  // Every render while open hands the latest content to the host, so it stays live.
  useLayoutEffect(() => {
    if (visible) put(id.current, children);
    else remove(id.current);
  });
  useEffect(() => () => remove(id.current), []);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      latest.current.onRequestClose();
      return true;
    });
    return () => sub.remove();
  }, [visible]);

  const wasVisible = useRef(visible);
  useEffect(() => {
    if (wasVisible.current && !visible) latest.current.onDismiss?.();
    wasVisible.current = visible;
  }, [visible]);

  return null;
}
