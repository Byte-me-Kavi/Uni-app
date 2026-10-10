import type { ComponentType, ReactNode } from 'react';
import { Text, View } from 'react-native';
import type { IconProps } from 'phosphor-react-native';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';

import { PressableScale } from '@/components/ui/pressable-scale';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// A titled group of settings rows on one rounded surface, like the phone's own settings.
export function SettingsGroup({ title, footer, children }: { title: string; footer?: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.card}>{children}</View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

type RowProps = {
  label: string;
  value?: string;
  Icon: ComponentType<IconProps>;
  /** Opens a screen for this setting. Without it the row is information only. */
  onPress?: () => void;
  first?: boolean;
};

export function SettingsRow({ label, value, Icon, onPress, first = false }: RowProps) {
  const theme = useTheme();
  const styles = useStyles();
  const content = (
    <>
      <View style={styles.icon}>
        <Icon size={20} weight="bold" color={theme.text} />
      </View>
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        {value ? (
          <Text style={styles.value} numberOfLines={2}>
            {value}
          </Text>
        ) : null}
      </View>
      {onPress ? <CaretRightIcon size={18} weight="bold" color={theme.textMuted} /> : null}
    </>
  );

  if (!onPress) {
    return (
      <View style={[styles.row, !first && styles.divider]} accessible accessibilityLabel={value ? `${label}: ${value}` : label}>
        {content}
      </View>
    );
  }
  return (
    <PressableScale
      onPress={onPress}
      scale={0.985}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}: ${value}` : label}
      style={[styles.row, !first && styles.divider]}>
      {content}
    </PressableScale>
  );
}

const useStyles = createThemedStyles((t) => ({
  group: { gap: space.sm },
  groupTitle: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted, paddingHorizontal: space.xs },
  card: { backgroundColor: t.surface, borderRadius: radius.lg, paddingHorizontal: space.lg },
  footer: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: t.textMuted, paddingHorizontal: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md + 2, minHeight: 60 },
  divider: { borderTopWidth: 1, borderTopColor: t.border },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm + 2,
    backgroundColor: t.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 1 },
  label: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  value: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: t.textMuted },
}));
