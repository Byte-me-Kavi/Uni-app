import { memo } from 'react';
import { Text, View } from 'react-native';
import { DeviceMobileIcon } from 'phosphor-react-native/src/icons/DeviceMobile';

import { PressableScale } from '@/components/ui/pressable-scale';
import { useModuleColour } from '@/lib/module-colours';
import type { ModuleCard } from '@/lib/modules';
import { useOnPhone } from '@/lib/offline';
import { createThemedStyles, fonts, radius, space } from '@/theme/tokens';

type Props = {
  module: ModuleCard;
  votesNeeded: number;
  /** How many files its folder holds, and how many arrived this week. */
  files?: { count: number; new: number };
  /** "Final in 12 days", in exam season. */
  exam?: string | null;
  onPress: (m: ModuleCard) => void;
};

// One module on the Resources tab, in its colour: its name (what students know it by), its code, how
// many files it holds, whether it is on the phone for offline, and whether it is still waiting for
// batchmates, an elective, or being repeated.
export const ModuleTile = memo(function ModuleTile({ module, votesNeeded, files, exam, onPress }: Props) {
  const styles = useStyles();
  const colour = useModuleColour(module.id);
  const onPhone = useOnPhone(module.id);
  const status = module.pending
    ? `Waiting · ${module.votes ?? 1} of ${votesNeeded}`
    : exam
      ? exam
      : module.kind === 'repeat'
      ? 'Repeating'
      : module.kind === 'elective'
        ? 'Elective'
        : null;
  const count = files?.count
    ? `${files.count === 1 ? '1 file' : `${files.count} files`}${files.new ? ` · ${files.new} new` : ''}`
    : null;
  return (
    <PressableScale
      scale={0.985}
      onPress={() => onPress(module)}
      accessibilityRole="button"
      accessibilityLabel={`${module.name}, ${module.code}${count ? `, ${count}` : ''}${onPhone ? ', on this phone' : ''}${status ? `, ${status}` : ''}`}
      style={[styles.tile, { backgroundColor: colour.bg }]}>
      <Text style={styles.name} numberOfLines={3}>
        {module.name}
      </Text>
      <Text style={[styles.code, { color: colour.fg }]} numberOfLines={1}>
        {module.code}
      </Text>
      {count || status || onPhone ? (
        <View style={styles.footer}>
          {count ? <Text style={styles.count}>{count}</Text> : null}
          {status || onPhone ? (
            <View style={styles.badges}>
              {onPhone ? (
                <View style={styles.badge}>
                  <DeviceMobileIcon size={12} weight="bold" color={colour.fg} />
                  <Text style={styles.badgeText}>On this phone</Text>
                </View>
              ) : null}
              {status ? (
                <View style={[styles.badge, (module.pending || !!exam) && styles.badgePending]}>
                  <Text style={[styles.badgeText, (module.pending || !!exam) && styles.badgeTextPending]}>{status}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </PressableScale>
  );
});

const useStyles = createThemedStyles((t) => ({
  tile: {
    flex: 1,
    minHeight: 120,
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.xs,
  },
  name: { fontFamily: fonts.display, fontSize: 17, lineHeight: 22, color: t.text, flexShrink: 1 },
  // Coloured per module (see module-colours.ts).
  code: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 0.2 },
  footer: { marginTop: 'auto', gap: space.xs, paddingTop: space.xs },
  count: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: t.textMuted },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: t.background,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  // Accent tint with Ink text: the brand's soft highlight.
  badgePending: { backgroundColor: t.accentTint },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.text },
  badgeTextPending: { color: t.onAccentTint },
}));
