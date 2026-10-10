import { Text, View } from 'react-native';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { CircleIcon } from 'phosphor-react-native/src/icons/Circle';

import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

export type SetupStep = {
  key: string;
  label: string;
  done: boolean;
  /** Not built yet: shown honestly instead of a button that goes nowhere. */
  comingSoon?: boolean;
};

export function SetupList({ steps }: { steps: SetupStep[] }) {
  const theme = useTheme();
  const styles = useStyles();
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.heading} accessibilityRole="header">
          Get set up
        </Text>
        <Text style={styles.progress}>
          {doneCount} of {steps.length}
        </Text>
      </View>
      <View style={styles.list}>
        {steps.map((step) => (
          <View
            key={step.key}
            style={styles.row}
            accessible
            accessibilityLabel={`${step.label}, ${step.done ? 'done' : step.comingSoon ? 'opens soon' : 'to do'}`}>
            {step.done ? (
              <CheckCircleIcon size={26} weight="fill" color={theme.text} />
            ) : (
              <CircleIcon size={26} weight="regular" color={theme.borderFilled} />
            )}
            <Text style={[styles.label, step.done && styles.labelDone]}>{step.label}</Text>
            {step.comingSoon && !step.done ? <Text style={styles.soon}>Opens soon</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  section: { gap: space.md },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  heading: { fontFamily: fonts.display, fontSize: 21, color: t.text },
  progress: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted },
  list: { backgroundColor: t.surface, borderRadius: radius.lg, paddingVertical: space.sm, paddingHorizontal: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52 },
  label: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 16, color: t.text },
  labelDone: { color: t.textMuted },
  // Red tint with Ink text: the brand's soft highlight.
  soon: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: brand.ink,
    backgroundColor: brand.redTint,
    paddingHorizontal: space.sm + 2,
    paddingVertical: 3,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
}));
