import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { EntranceContext, Reveal } from '@/components/motion/reveal';
import { KeyboardFrame, KeyboardScroll } from '@/components/ui/keyboard';
import { createThemedStyles, fonts, space } from '@/theme/tokens';

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
};

// The form rises in on the first auth screen of a launch only. Every later switch between
// sign-in, sign-up and verify is a plain crossfade of this form area; the logo, corner mark and
// background live in AuthChrome and never move.
let introPlayed = false;

// The changing part of an auth screen: heading, form and footer. Must sit inside AuthChrome, which
// draws the background, safe area and brand. The background here is transparent on purpose.
export function AuthScreen({ title, subtitle, children, footer }: Props) {
  const styles = useStyles();
  const [entrance] = useState(() => {
    const play = !introPlayed;
    introPlayed = true;
    return play;
  });

  return (
    <EntranceContext value={entrance}>
      <KeyboardFrame style={styles.flex}>
        <KeyboardScroll
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}>
          {/* Heading and form sit in the vertical centre of the space below the lockup. Long forms
              (sign-up) simply grow and scroll. */}
          <View style={styles.center}>
            <View style={styles.heading}>
              <Reveal order={0}>
                <Text style={styles.title} accessibilityRole="header">
                  {title}
                </Text>
              </Reveal>
              {subtitle ? (
                <Reveal order={1}>
                  <Text style={styles.subtitle}>{subtitle}</Text>
                </Reveal>
              ) : null}
            </View>
            <View style={styles.body}>{children}</View>
          </View>

          {footer ? (
            <Reveal order={8} style={styles.footer}>
              {footer}
            </Reveal>
          ) : null}
        </KeyboardScroll>
      </KeyboardFrame>
    </EntranceContext>
  );
}

const useStyles = createThemedStyles((t) => ({
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space.xl, paddingBottom: space.xl },
  center: { flex: 1, justifyContent: 'center', paddingVertical: space.xxxl, width: '100%', maxWidth: 520 },
  heading: { gap: space.sm, marginBottom: space.xxl },
  title: { fontFamily: fonts.display, fontSize: 32, lineHeight: 40, color: t.text, letterSpacing: -0.3 },
  subtitle: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: t.textMuted },
  body: { gap: space.lg },
  footer: { paddingTop: space.lg, alignItems: 'center' },
}));
