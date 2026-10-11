import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeIn,
  ZoomIn,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { CaretLeftIcon } from 'phosphor-react-native/src/icons/CaretLeft';
import { CaretUpIcon } from 'phosphor-react-native/src/icons/CaretUp';
import { LockSimpleIcon } from 'phosphor-react-native/src/icons/LockSimple';
import { LockSimpleOpenIcon } from 'phosphor-react-native/src/icons/LockSimpleOpen';
import { MicrophoneIcon } from 'phosphor-react-native/src/icons/Microphone';
import { PaperPlaneRightIcon } from 'phosphor-react-native/src/icons/PaperPlaneRight';
import { TrashIcon } from 'phosphor-react-native/src/icons/Trash';

import { fileSize } from '@/lib/chat/transfer';
import type { VoiceAttachment } from '@/lib/chat/types';
import { formatDuration, toWaveform } from '@/lib/chat/voice';
import { hasNative } from '@/lib/native';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// Voice notes, as in WhatsApp: hold the mic to record and let go to send. Slide left to cancel
// (the hint nudges left so it is noticed, and follows your finger). Slide up to lock: recording
// carries on hands-free, with a bin to throw it away and a send button.
// Mono AAC at 32 kbps: clear speech at about 240 KB a minute. Loaded only on builds that have
// expo-audio (see native.ts).
//
// The mic button itself is just a button. The recorder (a native object, checked 10 times a
// second for the timer and waveform) exists only while recording: keeping one ready in every open
// chat cost work on every chat open and kept the phone polling the whole time you read.

const OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 32000,
  isMeteringEnabled: true,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.MEDIUM },
  web: { mimeType: 'audio/mp4' },
};

const CANCEL_DX = -120; // slide this far left to cancel
const LOCK_DY = -90; // slide this far up to lock
const MIN_MS = 700;

export type RecordingState = { recording: boolean };
type Phase = 'idle' | 'holding' | 'locked' | 'sending' | 'cancelled';
// What the recording session should do next: keep going (done false), send, or throw it away.
type Control = { done: boolean; cancel: boolean };

type Props = {
  onRecorded: (voice: VoiceAttachment) => void;
  /** Recording or not: the message box hides its other controls while it is. */
  onState: (state: RecordingState) => void;
  onError: (message: string) => void;
};

function buzz(kind: 'light' | 'medium' = 'light') {
  if (!hasNative('ExpoHaptics')) return;
  const Haptics = require('expo-haptics') as typeof import('expo-haptics');
  Haptics.impactAsync(kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function VoiceRecorder({ onRecorded, onState, onError }: Props) {
  const styles = useStyles();
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  // Sending and cancelling end with a short animation; the message box comes back only when that
  // has played and the recording has been stopped, so nothing is cut off midway.
  const [animDone, setAnimDone] = useState(false);
  const [sessionDone, setSessionDone] = useState(false);
  const control = useRef<Control>({ done: false, cancel: false });
  const locked = useRef(false);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const held = useSharedValue(0);
  const report = useRef(onState);
  report.current = onState;

  useEffect(() => {
    report.current({ recording: phase !== 'idle' });
    held.set(withSpring(phase === 'holding' ? 1 : 0, { damping: 14, stiffness: 220 }));
  }, [phase, held]);

  useEffect(() => {
    if ((phase === 'sending' || phase === 'cancelled') && animDone && sessionDone) setPhase('idle');
  }, [phase, animDone, sessionDone]);

  function end(cancel: boolean) {
    control.current = { done: true, cancel };
    setAnimDone(false);
    setPhase(cancel ? 'cancelled' : 'sending');
  }

  function settle() {
    dragX.set(withSpring(0, { damping: 18, stiffness: 220 }));
    dragY.set(withSpring(0, { damping: 18, stiffness: 220 }));
  }

  const hold = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .shouldCancelWhenOutside(false)
    .onBegin(() => {
      control.current = { done: false, cancel: false };
      locked.current = false;
      setSessionDone(false);
      setAnimDone(false);
      dragX.set(0);
      dragY.set(0);
      setSeconds(0);
      setPhase('holding');
      buzz();
    })
    .onUpdate((e) => {
      if (locked.current || control.current.done) return;
      dragX.set(Math.min(0, e.translationX));
      dragY.set(Math.min(0, e.translationY));
      if (e.translationX < CANCEL_DX) {
        // Slid far enough: thrown away at once, as in WhatsApp.
        buzz('medium');
        settle();
        end(true);
      } else if (e.translationY < LOCK_DY && e.translationX > CANCEL_DX / 2) {
        locked.current = true;
        buzz('medium');
        settle();
        setPhase('locked');
      }
    })
    .onFinalize(() => {
      if (locked.current || control.current.done) return;
      settle();
      end(false);
    });

  // The mic follows the finger a little, and grows while held.
  const micStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dragX.get() * 0.35 },
      { translateY: dragY.get() * 0.35 },
      { scale: 1 + held.get() * 0.3 },
    ],
  }));

  // The session stays through 'cancelled' too, so a thrown-away recording is stopped cleanly.
  const recording = phase !== 'idle';
  return (
    <View style={[styles.wrap, phase !== 'idle' && styles.wrapActive]}>
      {phase === 'holding' ? <HoldingBar seconds={seconds} dragX={dragX} /> : null}
      {phase === 'locked' ? (
        <LockedBar
          seconds={seconds}
          onDiscard={() => {
            buzz();
            end(true);
          }}
        />
      ) : null}
      {phase === 'sending' ? <SendingBar seconds={seconds} onDone={() => setAnimDone(true)} /> : null}
      {phase === 'cancelled' ? <CancelledBar onDone={() => setAnimDone(true)} /> : null}

      <View style={styles.micSlot}>
        {phase === 'holding' ? <LockHint dragY={dragY} /> : null}
        {phase === 'locked' || phase === 'sending' ? (
          <Pressable
            disabled={phase === 'sending'}
            onPress={() => end(false)}
            accessibilityRole="button"
            accessibilityLabel="Send voice message"
            style={styles.send}>
            <PaperPlaneRightIcon size={20} weight="fill" color={brand.ink} />
          </Pressable>
        ) : (
          <GestureDetector gesture={hold}>
            <Animated.View
              style={[styles.mic, micStyle]}
              accessible
              accessibilityRole="button"
              accessibilityLabel="Hold to record a voice message"
              accessibilityHint="Let go to send. Slide left to cancel, or up to keep recording hands-free">
              <MicrophoneIcon size={22} color={brand.ink} weight="fill" />
            </Animated.View>
          </GestureDetector>
        )}
      </View>

      {recording ? (
        <Session
          control={control}
          onSeconds={setSeconds}
          onRecorded={onRecorded}
          onError={onError}
          onDone={() => {
            locked.current = false;
            setSessionDone(true);
            // Stopped before any ending animation (no permission, or an error): straight back.
            setPhase((p) => (p === 'holding' || p === 'locked' ? 'idle' : p));
          }}
        />
      ) : null}
    </View>
  );
}

// While holding: a blinking dot, the time, and "‹ Slide to cancel", which nudges left on its own
// and follows the finger, fading as it nears the point of cancelling.
function HoldingBar({ seconds, dragX }: { seconds: number; dragX: SharedValue<number> }) {
  const theme = useTheme();
  const styles = useStyles();
  const nudge = useSharedValue(0);
  useEffect(() => {
    nudge.set(
      withRepeat(
        withSequence(
          withTiming(-8, { duration: 450, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 450, easing: Easing.in(Easing.quad) }),
        ),
        -1,
      ),
    );
  }, [nudge]);
  const hint = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.get() * 0.6 + (dragX.get() > -4 ? nudge.get() : 0) }],
    opacity: interpolate(dragX.get(), [CANCEL_DX, 0], [0.15, 1], 'clamp'),
  }));
  return (
    <Animated.View entering={FadeIn.duration(120)} style={styles.bar} accessibilityLiveRegion="polite">
      <Blink />
      <Text style={styles.time}>{formatDuration(seconds)}</Text>
      <Animated.View style={[styles.hint, hint]}>
        <CaretLeftIcon size={16} color={theme.textMuted} weight="bold" />
        <Text style={styles.hintText}>Slide to cancel</Text>
      </Animated.View>
    </Animated.View>
  );
}

// Locked: recording carries on without holding. The bin throws it away; send is on the right.
function LockedBar({ seconds, onDiscard }: { seconds: number; onDiscard: () => void }) {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <Animated.View entering={FadeIn.duration(150)} style={styles.bar} accessibilityLiveRegion="polite">
      <Pressable onPress={onDiscard} accessibilityRole="button" accessibilityLabel="Delete recording" hitSlop={8} style={styles.bin}>
        <TrashIcon size={22} color={theme.dangerText} weight="bold" />
      </Pressable>
      <Blink />
      <Text style={styles.time}>{formatDuration(seconds)}</Text>
      <Text style={styles.lockedText}>Recording</Text>
    </Animated.View>
  );
}

// Sent: the time stays, the paper plane flies off to the right and the bar fades, then the
// message box comes back.
function SendingBar({ seconds, onDone }: { seconds: number; onDone: () => void }) {
  const theme = useTheme();
  const styles = useStyles();
  const fly = useSharedValue(0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    fly.set(withTiming(1, { duration: 380, easing: Easing.in(Easing.cubic) }));
    const timer = setTimeout(() => done.current(), 420);
    return () => clearTimeout(timer);
  }, [fly]);
  const plane = useAnimatedStyle(() => ({
    transform: [{ translateX: fly.get() * 160 }, { translateY: -fly.get() * 18 }, { rotate: `${-fly.get() * 12}deg` }],
    opacity: 1 - fly.get() * 0.8,
  }));
  const fade = useAnimatedStyle(() => ({ opacity: 1 - fly.get() * 0.6 }));
  return (
    <Animated.View style={[styles.bar, fade]} accessibilityLiveRegion="polite" accessibilityLabel="Voice message sent">
      <View style={[styles.dot, styles.dotSent]} />
      <Text style={styles.time}>{formatDuration(seconds)}</Text>
      <Animated.View style={[styles.hint, plane]}>
        <PaperPlaneRightIcon size={20} weight="fill" color={theme.accentText} />
      </Animated.View>
    </Animated.View>
  );
}

// Thrown away: the mic drops into the bin, the bin gives a little shake, and "Deleted" fades out.
function CancelledBar({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const styles = useStyles();
  const drop = useSharedValue(0);
  const shake = useSharedValue(0);
  const fade = useSharedValue(1);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    drop.set(withTiming(1, { duration: 420, easing: Easing.in(Easing.quad) }));
    shake.set(
      withDelay(
        420,
        withSequence(
          withTiming(-14, { duration: 70 }),
          withTiming(12, { duration: 90 }),
          withTiming(-6, { duration: 80 }),
          withTiming(0, { duration: 70 }),
        ),
      ),
    );
    fade.set(withDelay(850, withTiming(0, { duration: 220 })));
    const timer = setTimeout(() => done.current(), 1080);
    return () => clearTimeout(timer);
  }, [drop, shake, fade]);
  const mic = useAnimatedStyle(() => ({
    transform: [{ translateY: -34 + drop.get() * 34 }, { scale: 1 - drop.get() * 0.6 }],
    opacity: 1 - Math.max(0, drop.get() - 0.8) * 5,
  }));
  const bin = useAnimatedStyle(() => ({ transform: [{ rotate: `${shake.get()}deg` }] }));
  const bar = useAnimatedStyle(() => ({ opacity: fade.get() }));
  return (
    <Animated.View style={[styles.bar, bar]} accessibilityLiveRegion="polite" accessibilityLabel="Voice message deleted">
      <View style={styles.binSlot}>
        <Animated.View style={[styles.binMic, mic]}>
          <MicrophoneIcon size={18} color={theme.dangerText} weight="fill" />
        </Animated.View>
        {/* The pop-in and the shake are on separate views: an entry animation would override the
            shake's transform. */}
        <Animated.View entering={ZoomIn.springify().damping(12)}>
          <Animated.View style={bin}>
            <TrashIcon size={26} color={theme.dangerText} weight="fill" />
          </Animated.View>
        </Animated.View>
      </View>
      <Text style={[styles.hintText, { color: theme.dangerText }]}>Deleted</Text>
    </Animated.View>
  );
}

// Above the mic while holding: a lock with an arrow bouncing upwards. It follows the finger and
// closes as you reach it.
function LockHint({ dragY }: { dragY: SharedValue<number> }) {
  const theme = useTheme();
  const styles = useStyles();
  const bounce = useSharedValue(0);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    bounce.set(withRepeat(withSequence(withTiming(-5, { duration: 500 }), withTiming(0, { duration: 500 })), -1));
  }, [bounce]);
  // The lock shows closed once the finger is most of the way up (checked a few times a second).
  useEffect(() => {
    const timer = setInterval(() => setClosing(dragY.get() < LOCK_DY * 0.7), 80);
    return () => clearInterval(timer);
  }, [dragY]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateY: Math.max(dragY.get() * 0.5, LOCK_DY * 0.5) }] }));
  const arrow = useAnimatedStyle(() => ({
    transform: [{ translateY: bounce.get() }],
    opacity: interpolate(dragY.get(), [LOCK_DY * 0.7, 0], [0, 1], 'clamp'),
  }));
  return (
    // Fade-in on the outer view, the finger-following move on the inner one (an entry animation
    // would override the move's transform).
    <Animated.View entering={FadeIn.duration(150)} style={styles.lockSlot} pointerEvents="none">
      <Animated.View style={[styles.lockPill, pill]}>
        {closing ? (
          <LockSimpleIcon size={18} color={theme.text} weight="bold" />
        ) : (
          <LockSimpleOpenIcon size={18} color={theme.text} weight="bold" />
        )}
        <Animated.View style={arrow}>
          <CaretUpIcon size={14} color={theme.textMuted} weight="bold" />
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

function Blink() {
  const styles = useStyles();
  const on = useSharedValue(1);
  useEffect(() => {
    on.set(withRepeat(withTiming(0.2, { duration: 600 }), -1, true));
  }, [on]);
  const style = useAnimatedStyle(() => ({ opacity: on.get() }));
  return <Animated.View style={[styles.dot, style]} />;
}

// One recording, from the finger going down until it is sent or thrown away. Draws nothing.
function Session({
  control,
  onSeconds,
  onRecorded,
  onError,
  onDone,
}: {
  control: { current: Control };
  onSeconds: (seconds: number) => void;
  onRecorded: (voice: VoiceAttachment) => void;
  onError: (message: string) => void;
  onDone: () => void;
}) {
  const recorder = useAudioRecorder(OPTIONS);
  const status = useAudioRecorderState(recorder, 100);
  const samples = useRef<number[]>([]);
  const started = useRef(false);
  const finished = useRef(false);
  // The parent passes new callbacks each render; read through refs so the effects below follow
  // the recorder only.
  const callbacks = useRef({ onSeconds, onRecorded, onError, onDone });
  callbacks.current = { onSeconds, onRecorded, onError, onDone };

  useEffect(() => {
    if (status.isRecording && typeof status.metering === 'number') samples.current.push(status.metering);
    if (started.current) callbacks.current.onSeconds(Math.floor(status.durationMillis / 1000));
    // Sent or thrown away: checked on each tick, so it reacts within a tenth of a second.
    if (started.current && control.current.done) finish(control.current.cancel);
  }, [status.isRecording, status.metering, status.durationMillis]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        callbacks.current.onError('Allow microphone access in your phone settings to send voice notes.');
        callbacks.current.onDone();
        return;
      }
      // Let go during the permission prompt: nothing to record.
      if (!alive || control.current.done) {
        callbacks.current.onDone();
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      started.current = true;
      // Let go while the microphone was getting ready: drop it quietly.
      if (control.current.done) await finish(true);
    })().catch(() => {
      callbacks.current.onError('Could not start recording.');
      callbacks.current.onDone();
    });
    return () => {
      alive = false;
    };
  }, []);

  async function finish(cancel: boolean) {
    if (!started.current || finished.current) return;
    finished.current = true;
    const duration = recorder.getStatus().durationMillis;
    await recorder.stop().catch(() => {});
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    const { onRecorded: recorded, onError: error, onDone: done } = callbacks.current;
    const uri = recorder.uri;
    if (!cancel && uri) {
      if (duration < MIN_MS) error('Hold to record, let go to send.');
      else {
        recorded({
          local_uri: uri,
          size: await fileSize(uri),
          mime: 'audio/mp4',
          duration: Math.round(duration),
          waveform: toWaveform(samples.current),
        });
      }
    }
    done();
  }

  return null;
}

const useStyles = createThemedStyles((t) => ({
  // Pinned to the right edge: for a frame after recording ends the row holds only the mic, and
  // without this it flashed at the left before the text box came back.
  wrap: { flexDirection: 'row', alignItems: 'flex-end', marginLeft: 'auto' },
  wrapActive: { flex: 1 },
  bar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 44, paddingLeft: space.sm, overflow: 'hidden' },
  // A recording is shown in red, like every phone's recording light.
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: brand.danger },
  time: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text, minWidth: 44, fontVariant: ['tabular-nums'] },
  hint: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  hintText: { fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: t.textMuted },
  lockedText: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: t.textMuted },
  bin: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  binSlot: { width: 36, height: 44, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 8 },
  binMic: { position: 'absolute', top: 6 },
  dotSent: { backgroundColor: t.accentText },
  micSlot: { width: 44, height: 44, alignItems: 'center', justifyContent: 'flex-end' },
  // The accent marks the thing to do; what sits on it is Ink.
  mic: { width: 44, height: 44, borderRadius: 22, backgroundColor: brand.accent, alignItems: 'center', justifyContent: 'center' },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: brand.accent, alignItems: 'center', justifyContent: 'center' },
  lockSlot: { position: 'absolute', bottom: 64, width: 40 },
  lockPill: {
    width: 40,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: t.elevated,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: 'center',
    gap: 4,
  },
}));
