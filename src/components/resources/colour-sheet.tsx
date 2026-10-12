import { useState } from 'react';
import { Text, View } from 'react-native';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { MODULE_COLOURS, setModuleColour, swatch, useChosenColour, useModuleColour } from '@/lib/module-colours';
import { useSession } from '@/providers/session-provider';
import { useScheme } from '@/theme/appearance';
import { createThemedStyles, fonts, space } from '@/theme/tokens';

type Props = { visible: boolean; moduleId: number; name: string; onClose: () => void };

// Choose a module's colour (it shows on its tile, in pickers, chat folder tags and kuppi). Only for
// this student, on every phone they use.
export function ColourSheet({ visible, moduleId, name, onClose }: Props) {
  return (
    <BottomSheet visible={visible} title="Module colour" onClose={onClose} height={0.6}>
      {visible ? <Picker moduleId={moduleId} name={name} onDone={onClose} /> : null}
    </BottomSheet>
  );
}

function Picker({ moduleId, name, onDone }: { moduleId: number; name: string; onDone: () => void }) {
  const styles = useStyles();
  const scheme = useScheme();
  const session = useSession();
  const uid = session.status === 'signed_in' ? session.session.user.id : null;
  const current = useModuleColour(moduleId);
  const chosen = useChosenColour(moduleId);
  const [error, setError] = useState<string | null>(null);

  async function pick(colour: (typeof MODULE_COLOURS)[number] | null) {
    if (!uid) return;
    setError(null);
    const e = await setModuleColour(uid, moduleId, colour);
    if (e) setError(e);
    else onDone();
  }

  return (
    <View style={styles.body}>
      <Text style={styles.lead} numberOfLines={2}>
        {name}: on its tile, in module lists, chat folder tags and kuppi. Only you see your colours.
      </Text>
      <View style={styles.grid}>
        {MODULE_COLOURS.map((key) => {
          const s = swatch(key, scheme);
          const selected = current.key === key;
          return (
            <PressableScale
              key={key}
              onPress={() => pick(key)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={s.label}
              style={styles.option}>
              <View style={[styles.swatch, { backgroundColor: s.bg, borderColor: selected ? s.fg : s.bg }]}>
                {selected ? <CheckIcon size={20} weight="bold" color={s.fg} /> : <View style={[styles.inner, { backgroundColor: s.fg }]} />}
              </View>
              <Text style={styles.label}>{s.label}</Text>
            </PressableScale>
          );
        })}
      </View>
      {chosen ? (
        <PressableScale onPress={() => pick(null)} accessibilityRole="button" hitSlop={8} style={styles.reset}>
          <Text style={styles.link}>Use the app&apos;s colour</Text>
        </PressableScale>
      ) : null}
      <FormMessage message={error} />
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  body: { paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.lg },
  lead: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.lg },
  option: { width: '25%', alignItems: 'center', gap: space.xs },
  swatch: { width: 52, height: 52, borderRadius: 26, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  inner: { width: 18, height: 18, borderRadius: 9 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: t.text },
  reset: { alignSelf: 'center', minHeight: 40, justifyContent: 'center' },
  link: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.accentText },
}));
