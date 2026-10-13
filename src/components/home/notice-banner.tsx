import { Text, View } from 'react-native';
import { MegaphoneIcon } from 'phosphor-react-native/src/icons/Megaphone';

import { useNotice } from '@/lib/app-config';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// A message from the Uni Era team to every student (an incident, maintenance), set by national
// admins in App switches. Nothing when there is none.
export function NoticeBanner() {
  const theme = useTheme();
  const styles = useStyles();
  const notice = useNotice();
  if (!notice) return null;
  return (
    <View style={styles.banner} accessible accessibilityRole="alert" accessibilityLabel={`From the Uni Era team: ${notice}`}>
      <MegaphoneIcon size={20} weight="fill" color={theme.onAccentTint} />
      <Text style={styles.text}>{notice}</Text>
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: t.accentTint,
    borderRadius: radius.md,
    padding: space.md,
  },
  text: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 21, color: t.onAccentTint },
}));
