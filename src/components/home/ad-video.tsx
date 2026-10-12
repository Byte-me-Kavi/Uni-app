import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';

// A video ad: muted, looping, playing only while its slide is the one showing. Loaded only on app
// builds that have the video module (see ad-slide.tsx); it fades in over the cover image once the
// first frame is ready, so there is no black flash. Muted video never pauses the student's music.
export default function AdVideo({ uri, playing }: { uri: string; playing: boolean }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.audioMixingMode = 'mixWithOthers';
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });

  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [playing, player]);

  return (
    <VideoView
      player={player}
      style={[StyleSheet.absoluteFill, { opacity: status === 'readyToPlay' ? 1 : 0 }]}
      contentFit="cover"
      nativeControls={false}
      accessible={false}
    />
  );
}
