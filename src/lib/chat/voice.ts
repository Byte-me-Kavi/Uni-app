import { useSyncExternalStore } from 'react';

import { hasNative } from '@/lib/native';

// Voice notes: one plays at a time, like WhatsApp. Starting another stops the first; leaving the
// chat stops it. expo-audio loads on first use (see native.ts), so builds without it still start.

type Audio = typeof import('expo-audio');
type Player = ReturnType<Audio['createAudioPlayer']>;

export type VoiceState = { messageId: string | null; playing: boolean; position: number; duration: number; rate: number };

let player: Player | null = null;
let state: VoiceState = { messageId: null, playing: false, position: 0, duration: 0, rate: 1 };
const listeners = new Set<() => void>();
const set = (patch: Partial<VoiceState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const voiceAvailable = () => hasNative('ExpoAudio');
const audio = () => require('expo-audio') as Audio;

function ensurePlayer() {
  if (player) return player;
  const { createAudioPlayer, setAudioModeAsync } = audio();
  setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  player = createAudioPlayer(null, { updateInterval: 200 });
  player.addListener('playbackStatusUpdate', (status) => {
    set({
      playing: status.playing,
      position: status.currentTime,
      duration: status.duration || state.duration,
    });
    if (status.didJustFinish) {
      player?.seekTo(0).catch(() => {});
      set({ playing: false, position: 0 });
    }
  });
  return player;
}

/** Plays (or pauses) a voice note. */
export function toggleVoice(messageId: string, uri: string, durationMs: number) {
  const p = ensurePlayer();
  if (state.messageId === messageId) {
    if (state.playing) p.pause();
    else p.play();
    return;
  }
  p.replace({ uri });
  p.setPlaybackRate(state.rate);
  set({ messageId, playing: true, position: 0, duration: durationMs / 1000 });
  p.play();
}

export function seekVoice(messageId: string, seconds: number) {
  if (state.messageId !== messageId || !player) return;
  player.seekTo(seconds).catch(() => {});
  set({ position: seconds });
}

/** 1x, 1.5x, 2x, as in WhatsApp. */
export function cycleVoiceRate() {
  const rate = state.rate === 1 ? 1.5 : state.rate === 1.5 ? 2 : 1;
  player?.setPlaybackRate(rate);
  set({ rate });
}

export function stopVoice() {
  player?.pause();
  set({ messageId: null, playing: false, position: 0 });
}

export function useVoice<T>(select: (s: VoiceState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
    () => select(state),
  );
}

/** Turns metering samples (dBFS, about -60 to 0) into up to 64 bars from 0 to 15. */
export function toWaveform(samples: number[]) {
  if (samples.length === 0) return [];
  const bars = Math.min(64, samples.length);
  const per = samples.length / bars;
  return Array.from({ length: bars }, (_, i) => {
    const slice = samples.slice(Math.floor(i * per), Math.max(Math.floor((i + 1) * per), Math.floor(i * per) + 1));
    const db = Math.max(...slice);
    return Math.round(Math.min(15, Math.max(0, ((db + 55) / 55) * 15)));
  });
}

export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
