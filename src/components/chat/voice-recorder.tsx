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
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { MicrophoneIcon } from 'phosphor-react-native/src/icons/Microphone';

import { fileSize } from '@/lib/chat/transfer';
import type { VoiceAttachment } from '@/lib/chat/types';
import { toWaveform } from '@/lib/chat/voice';
import { brand } from '@/theme/tokens';

// Voice notes: hold the mic to record, let go to send, slide left to cancel (as in WhatsApp).
// Mono AAC at 32 kbps: clear speech at about 240 KB a minute. Loaded only on builds that have
// expo-audio (see native.ts).
//
// The mic button itself is just a button. The recorder (a native object, checked 10 times a
// second for the timer and waveform) exists only while you hold it: keeping one ready in every
// open chat cost work on every chat open and kept the phone polling the whole time you read.

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

const CANCEL_DX = -110;
const MIN_MS = 700;

export type RecordingState = { recording: boolean; seconds: number; cancelling: boolean };

type Props = {
  onRecorded: (voice: VoiceAttachment) => void;
  onState: (state: RecordingState) => void;
  onError: (message: string) => void;
};

export function VoiceRecorder(props: Props) {
  const [holding, setHolding] = useState(false);
  // Let go (and whether the finger had slid far enough left to cancel): read by the session.
  const release = useRef<{ released: boolean; cancel: boolean }>({ released: false, cancel: false });
  const cancelling = useRef(false);

  const hold = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .shouldCancelWhenOutside(false)
    .onBegin(() => {
      release.current = { released: false, cancel: false };
      cancelling.current = false;
      setHolding(true);
    })
    .onUpdate((e) => {
      const next = e.translationX < CANCEL_DX;
      if (next !== cancelling.current) cancelling.current = next;
    })
    .onFinalize(() => {
      release.current = { released: true, cancel: cancelling.current };
    });

  return (
    <GestureDetector gesture={hold}>
      <View
        style={[styles.mic, holding && styles.micLive]}
        accessible
        accessibilityRole="button"
        accessibilityLabel="Hold to record a voice message"
        accessibilityHint="Let go to send, slide left to cancel">
        <MicrophoneIcon size={22} color={brand.ink} weight="fill" />
        {holding ? <Session {...props} release={release} cancelling={cancelling} onDone={() => setHolding(false)} /> : null}
      </View>
    </GestureDetector>
  );
}

// One recording, from the finger going down to it lifting. Draws nothing.
function Session({
  onRecorded,
  onState,
  onError,
  release,
  cancelling,
  onDone,
}: Props & {
  release: { current: { released: boolean; cancel: boolean } };
  cancelling: { current: boolean };
  onDone: () => void;
}) {
  const recorder = useAudioRecorder(OPTIONS);
  const status = useAudioRecorderState(recorder, 100);
  const samples = useRef<number[]>([]);
  const started = useRef(false);
  // The parent passes new callbacks each render; read through refs so the effects below follow
  // the recorder only (depending on them made each report trigger another, forever).
  const callbacks = useRef({ onRecorded, onState, onError, onDone });
  callbacks.current = { onRecorded, onState, onError, onDone };

  useEffect(() => {
    if (status.isRecording && typeof status.metering === 'number') samples.current.push(status.metering);
    if (started.current) {
      callbacks.current.onState({ recording: status.isRecording, seconds: status.durationMillis / 1000, cancelling: cancelling.current });
    }
    // Let go: finish. Checked on each tick, so it reacts within a tenth of a second.
    if (started.current && release.current.released) finish(release.current.cancel);
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
      if (!alive || release.current.released) {
        callbacks.current.onDone();
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      started.current = true;
      // Let go while the microphone was getting ready: drop it quietly.
      if (release.current.released) {
        await finish(true);
        return;
      }
      callbacks.current.onState({ recording: true, seconds: 0, cancelling: cancelling.current });
    })().catch(() => {
      callbacks.current.onError('Could not start recording.');
      callbacks.current.onDone();
    });
    return () => {
      alive = false;
    };
  }, []);

  async function finish(cancel: boolean) {
    if (!started.current) return;
    started.current = false;
    const duration = recorder.getStatus().durationMillis;
    await recorder.stop().catch(() => {});
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    const { onRecorded: recorded, onState: state, onError: error, onDone: done } = callbacks.current;
    state({ recording: false, seconds: 0, cancelling: false });
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

const styles = StyleSheet.create({
  // Red marks the thing to do; what sits on red is Ink.
  mic: { width: 44, height: 44, borderRadius: 22, backgroundColor: brand.red, alignItems: 'center', justifyContent: 'center' },
  micLive: { transform: [{ scale: 1.25 }] },
});
