import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

type Props = {
  size?: number;
  dotColor?: string;
  youColor?: string;
};

const DOTS = 7;

// The Gansiya mark: a ring of seven students, with the red "you" dot at the top.
// Plain views instead of SVG: no extra native dependency and nothing to load at startup.
export function LogoRing({ size = 64, dotColor = colors.white, youColor = colors.red }: Props) {
  const dot = size * 0.2;
  const radius = (size - dot) / 2;
  const center = size / 2;

  return (
    <View
      style={{ width: size, height: size }}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Gansiya">
      {Array.from({ length: DOTS }, (_, i) => {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / DOTS;
        return (
          <View
            key={i}
            style={[
              styles.dot,
              {
                width: dot,
                height: dot,
                borderRadius: dot / 2,
                left: center + radius * Math.cos(angle) - dot / 2,
                top: center + radius * Math.sin(angle) - dot / 2,
                backgroundColor: i === 0 ? youColor : dotColor,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { position: 'absolute' },
});
