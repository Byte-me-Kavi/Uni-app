import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { PauseIcon } from 'phosphor-react-native/src/icons/Pause';
import { PlayIcon } from 'phosphor-react-native/src/icons/Play';

import { Avatar } from '@/components/ui/avatar';
import { signedUrl } from '@/lib/chat/media-urls';
import { useChatState } from '@/lib/chat/store';
import type { Message, VoiceAttachment } from '@/lib/chat/types';
import { cycleVoiceRate, formatDuration, seekVoice, toggleVoice, useVoice, voiceAvailable } from '@/lib/chat/voice';
import { UPDATE_APP } from '@/lib/native';
import { createThemedStyles, fonts, space, useTheme } from '@/theme/tokens';

// A voice note: play/pause, its waveform (filled as it plays; tap a bar to jump there), the time,
// and the speed (1x, 1.5x, 2x). Your own play from the phone's copy.
export function VoiceMessage({ message, voice, mine }: { message: Message; voice: VoiceAttachment; mine: boolean }) {
  const theme = useTheme();
  const styles = useStyles();
  const current = useVoice((s) => s.messageId === message.id);
  const playing = useVoice((s) => s.messageId === message.id && s.playing);
  const position = useVoice((s) => (s.messageId === message.id ? s.position : 0));
  const rate = useVoice((s) => s.rate);
  const progress = useChatState((s) => s.uploads[message.id]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = voice.duration / 1000;
  const bars = voice.waveform.length ? voice.waveform : Array.from({ length: 32 }, () => 3);
  const share = total > 0 ? Math.min(1, position / total) : 0;
  const sending = message.status === 'pending';

  async function toggle() {
    setError(null);
    if (!voiceAvailable()) {
      setError(UPDATE_APP);
      return;
    }
    let uri = voice.local_uri ?? null;
    if (!uri && voice.path) {
      setLoading(true);
      uri = await signedUrl(voice.path);
      setLoading(false);
    }
    if (!uri) {
      setError('Could not play this. Check your connection.');
      return;
    }
    toggleVoice(message.id, uri, voice.duration);
  }

  return (
    <View>
      <View style={styles.row}>
        {!mine ? <Avatar name={message.sender_name ?? '?'} path={message.sender_avatar} size={40} /> : null}
        <Pressable
          onPress={toggle}
          disabled={sending}
          accessibilityRole="button"
          accessibilityLabel={`${playing ? 'Pause' : 'Play'} voice message, ${formatDuration(total)}`}
          hitSlop={8}
          style={styles.play}>
          {loading ? (
            <ActivityIndicator color={theme.text} />
          ) : playing ? (
            <PauseIcon size={26} color={theme.text} weight="fill" />
          ) : (
            <PlayIcon size={26} color={theme.text} weight="fill" />
          )}
        </Pressable>
        <View style={styles.wave} accessible={false}>
          {bars.map((level, i) => (
            <Pressable
              key={i}
              disabled={!current}
              onPress={() => seekVoice(message.id, (i / bars.length) * total)}
              style={styles.barSlot}>
              <View
                style={[
                  styles.bar,
                  { height: 4 + level * 1.6 },
                  i / bars.length < share ? styles.barPlayed : null,
                ]}
              />
            </Pressable>
          ))}
        </View>
        {current ? (
          <Pressable onPress={cycleVoiceRate} accessibilityRole="button" accessibilityLabel={`Speed ${rate} times`} style={styles.rate}>
            <Text style={styles.rateText}>{rate}x</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={[styles.time, { marginLeft: mine ? 44 : 92 }]}>
        {sending
          ? progress === undefined
            ? 'Waiting to send'
            : `Sending ${Math.round(progress * 100)}%`
          : current
            ? formatDuration(position)
            : formatDuration(total)}
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minWidth: 230 },
  play: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  wave: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 32 },
  barSlot: { flex: 1, height: 32, alignItems: 'center', justifyContent: 'center' },
  bar: { width: 2.5, borderRadius: 2, backgroundColor: t.textMuted, opacity: 0.55 },
  barPlayed: { backgroundColor: t.tickRead, opacity: 1 },
  rate: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: 10, backgroundColor: t.background },
  rateText: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.text },
  time: { fontFamily: fonts.bodySemiBold, fontSize: 11.5, color: t.textMuted, marginTop: 1 },
  error: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.dangerText, marginTop: 2 },
}));
