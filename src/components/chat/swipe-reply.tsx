import { useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { ArrowBendUpLeftIcon } from 'phosphor-react-native/src/icons/ArrowBendUpLeft';

import { hasNative } from '@/lib/native';
import { useTheme } from '@/theme/tokens';

const TRIGGER = 56;
const MAX = 84;

// Swipe a message right to reply, as in WhatsApp. Only clearly sideways drags count, so scrolling
// the chat is never mistaken for a swipe. A tick of haptic feedback marks the moment it will reply.
//
// Built on React Native's own touch system rather than a native gesture per bubble: a chat opens
// with dozens of bubbles, and registering a native gesture and two animations for each one was a
// large part of what a chat cost to open. Here a bubble costs nothing until a finger moves on it,
// and the reply arrow is only drawn once a swipe starts.
export function SwipeReply({ children, onReply, enabled }: { children: ReactNode; onReply: () => void; enabled: boolean }) {
  const theme = useTheme();
  const [swiping, setSwiping] = useState(false);
  const x = useRef<Animated.Value | null>(null);
  const armed = useRef(false);
  const latest = useRef({ onReply, enabled });
  latest.current = { onReply, enabled };

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => latest.current.enabled && g.dx > 18 && Math.abs(g.dy) < 12,
      onMoveShouldSetPanResponderCapture: (_, g) => latest.current.enabled && g.dx > 18 && Math.abs(g.dy) < 12,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        if (!x.current) x.current = new Animated.Value(0);
        armed.current = false;
        setSwiping(true);
      },
      onPanResponderMove: (_, g) => {
        const value = Math.max(0, Math.min(MAX, g.dx * 0.7));
        x.current?.setValue(value);
        if (value >= TRIGGER && !armed.current) {
          armed.current = true;
          tick();
        } else if (value < TRIGGER) armed.current = false;
      },
      onPanResponderRelease: () => settle(),
      onPanResponderTerminate: () => settle(),
    }),
  ).current;

  function settle() {
    if (armed.current) latest.current.onReply();
    armed.current = false;
    if (!x.current) return;
    Animated.spring(x.current, { toValue: 0, damping: 20, stiffness: 260, mass: 1, useNativeDriver: true }).start(() => setSwiping(false));
  }

  const value = x.current;
  return (
    <View {...responder.panHandlers}>
      {swiping && value ? (
        <Animated.View
          style={[
            styles.icon,
            {
              opacity: value.interpolate({ inputRange: [12, TRIGGER], outputRange: [0, 1], extrapolate: 'clamp' }),
              transform: [{ scale: value.interpolate({ inputRange: [12, TRIGGER], outputRange: [0.6, 1], extrapolate: 'clamp' }) }],
            },
          ]}
          pointerEvents="none">
          <View style={[styles.circle, { backgroundColor: theme.surface }]}>
            <ArrowBendUpLeftIcon size={18} color={theme.text} weight="bold" />
          </View>
        </Animated.View>
      ) : null}
      <Animated.View style={value ? { transform: [{ translateX: value }] } : null}>{children}</Animated.View>
    </View>
  );
}

function tick() {
  if (!hasNative('ExpoHaptics')) return;
  const Haptics = require('expo-haptics') as typeof import('expo-haptics');
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

const styles = StyleSheet.create({
  icon: { position: 'absolute', left: 14, top: 0, bottom: 0, justifyContent: 'center' },
  circle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
