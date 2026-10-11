import { useEffect } from 'react';
import { Pressable, Text } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { duration, EASE_OUT } from '@/theme/motion';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Props = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export function CheckRow({ label, checked, onChange }: Props) {
  const theme = useTheme();
  const styles = useStyles();
  const progress = useSharedValue(checked ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(checked ? 1 : 0, { duration: duration.state, easing: EASE_OUT });
  }, [checked, progress]);

  const { textMuted } = theme;
  const boxStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], ['rgba(56,189,248,0)', brand.accent]),
    borderColor: interpolateColor(progress.value, [0, 1], [textMuted, brand.accent]),
  }));

  // The tick grows from 60%, never from nothing, so it reads as the box filling in.
  const tickStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.6 + progress.value * 0.4 }],
  }));

  return (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      hitSlop={6}
      style={styles.row}>
      <Animated.View style={[styles.box, boxStyle]}>
        <Animated.Text style={[styles.tick, tickStyle]}>{'✓'}</Animated.Text>
      </Animated.View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const useStyles = createThemedStyles((t) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.sm - 1,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Ink on the accent in both themes.
  tick: { color: brand.ink, fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 18 },
  label: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 21, color: t.text },
}));
