import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LogoRing } from '@/components/brand/logo-ring';
import { Wordmark } from '@/components/brand/wordmark';
import { colors, fonts, space } from '@/theme/tokens';

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  showBrand?: boolean;
};

export function AuthScreen({ title, subtitle, children, footer, showBrand = true }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}>
          {showBrand ? (
            <View style={styles.brand}>
              <LogoRing size={44} />
              <Wordmark size={30} />
            </View>
          ) : null}
          <View style={styles.heading}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          <View style={styles.body}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.ink },
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space.xl, paddingTop: space.xxl, paddingBottom: space.xl },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.xxxl },
  heading: { gap: space.sm, marginBottom: space.xl },
  title: { fontFamily: fonts.display, fontSize: 26, lineHeight: 32, color: colors.white },
  subtitle: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.onInkMuted },
  body: { gap: space.lg },
  footer: { marginTop: 'auto', paddingTop: space.xl, alignItems: 'center' },
});
