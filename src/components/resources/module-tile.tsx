import { memo } from 'react';
import { Text, View } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import type { ModuleCard } from '@/lib/modules';
import { brand, createThemedStyles, fonts, radius, space } from '@/theme/tokens';

type Props = {
  module: ModuleCard;
  votesNeeded: number;
  /** How many files its folder holds, and how many arrived this week. */
  files?: { count: number; new: number };
  /** "Final in 12 days", in exam season. */
  exam?: string | null;
  onPress: (m: ModuleCard) => void;
};

// One module on the Resources tab: its code (the part students know it by), its name, and whether
// it is still waiting for batchmates or one being repeated.
export const ModuleTile = memo(function ModuleTile({ module, votesNeeded, files, exam, onPress }: Props) {
  const styles = useStyles();
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
      accessibilityLabel={`${module.code}, ${module.name}${count ? `, ${count}` : ''}${status ? `, ${status}` : ''}`}
      style={styles.tile}>
      <Text style={styles.code} numberOfLines={1}>
        {module.code}
      </Text>
      <Text style={styles.name} numberOfLines={3}>
        {module.name}
      </Text>
      {count || status ? (
        <View style={styles.footer}>
          {count ? <Text style={styles.count}>{count}</Text> : null}
          {status ? (
            <View style={[styles.badge, (module.pending || !!exam) && styles.badgePending]}>
              <Text style={[styles.badgeText, (module.pending || !!exam) && styles.badgeTextPending]}>{status}</Text>
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
  code: { fontFamily: fonts.display, fontSize: 18, color: t.accentText, letterSpacing: 0.2 },
  name: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 20, color: t.text, flexShrink: 1 },
  footer: { marginTop: 'auto', gap: space.xs, paddingTop: space.xs },
  count: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: t.textMuted },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: t.background,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  // Accent tint with Ink text: the brand's soft highlight.
  badgePending: { backgroundColor: brand.accentTint },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.text },
  badgeTextPending: { color: brand.ink },
}));
