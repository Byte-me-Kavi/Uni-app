import { Text, View } from 'react-native';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { CircleIcon } from 'phosphor-react-native/src/icons/Circle';

import { PressableScale } from '@/components/ui/pressable-scale';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

export type SetupStep = {
  key: string;
  label: string;
  done: boolean;
  /** Shown under the label, e.g. the batch you joined. */
  detail?: string;
  /** Not built yet: shown honestly instead of a button that goes nowhere. */
  comingSoon?: boolean;
  /** Makes the row tappable while it is not done. */
  onPress?: () => void;
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
        {steps.map((step) =>
          step.onPress && !step.done ? (
            <PressableScale
              key={step.key}
              scale={0.985}
              onPress={step.onPress}
              accessibilityRole="button"
              accessibilityLabel={`${step.label}, to do`}
              style={styles.row}>
              <StepContent step={step} />
              <CaretRightIcon size={18} weight="bold" color={theme.accentText} />
            </PressableScale>
          ) : (
            <View
              key={step.key}
              style={styles.row}
              accessible
              accessibilityLabel={`${step.label}, ${step.done ? 'done' : step.comingSoon ? 'opens soon' : 'to do'}`}>
              <StepContent step={step} />
              {step.comingSoon && !step.done ? <Text style={styles.soon}>Opens soon</Text> : null}
            </View>
          ),
        )}
      </View>
    </View>
  );
}

function StepContent({ step }: { step: SetupStep }) {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <>
      {step.done ? (
        <CheckCircleIcon size={26} weight="fill" color={theme.text} />
      ) : (
        <CircleIcon size={26} weight="regular" color={step.onPress ? theme.accentText : theme.borderFilled} />
      )}
      <View style={styles.copy}>
        <Text style={[styles.label, step.done && styles.labelDone]}>{step.label}</Text>
        {step.detail ? <Text style={styles.detail}>{step.detail}</Text> : null}
      </View>
    </>
  );
}

const useStyles = createThemedStyles((t) => ({
  section: { gap: space.md },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  heading: { fontFamily: fonts.display, fontSize: 21, color: t.text },
  progress: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted },
  list: { backgroundColor: t.surface, borderRadius: radius.lg, paddingVertical: space.sm, paddingHorizontal: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingVertical: space.xs },
  copy: { flex: 1, gap: 1 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: t.text },
  labelDone: { color: t.textMuted },
  detail: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: t.text },
  // Accent tint with Ink text: the brand's soft highlight.
  soon: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: brand.ink,
    backgroundColor: brand.accentTint,
    paddingHorizontal: space.sm + 2,
    paddingVertical: 3,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
}));
