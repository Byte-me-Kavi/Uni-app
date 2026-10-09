import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/theme/tokens';

type Props = {
  size?: number;
  color?: string;
};

// "gansiya" set in Unbounded, with a dotless i under a red dot (brand kit: logo system).
export function Wordmark({ size = 32, color = colors.white }: Props) {
  const text = [styles.text, { fontSize: size, lineHeight: size * 1.25, color }];
  const dot = size * 0.24;

  return (
    <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel="gansiya">
      <Text style={text}>gans</Text>
      <View style={styles.iColumn}>
        <View
          style={{
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: colors.red,
            marginBottom: -size * 0.2,
          }}
        />
        <Text style={text}>{'ı'}</Text>
      </View>
      <Text style={text}>ya</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  iColumn: { alignItems: 'center' },
  text: { fontFamily: fonts.display, includeFontPadding: false },
});
