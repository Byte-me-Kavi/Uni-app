import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LogoRing } from '@/components/brand/logo-ring';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { colors, fonts, space } from '@/theme/tokens';

// Placeholder home until the batch, resources and kuppi tabs land (tasks H4, H5).
export default function Home() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <LogoRing size={56} dotColor={colors.ink} />
        <Text style={styles.title}>You are in.</Text>
        <Text style={styles.body}>Your batch, resources and kuppi will appear here.</Text>
      </View>
      <View style={styles.signOut}>
        <Button label="Sign out" onPress={() => supabase.auth.signOut()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl },
  title: { fontFamily: fonts.display, fontSize: 26, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 16, color: colors.graphite, textAlign: 'center' },
  signOut: { padding: space.xl },
});
