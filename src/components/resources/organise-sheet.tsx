import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { CheckRow } from '@/components/ui/check-row';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { CATEGORIES, type Category } from '@/lib/library';
import { useMyModules, type ModuleCard } from '@/lib/modules';
import { brand, createThemedStyles, fonts, radius, space } from '@/theme/tokens';

type Props = {
  visible: boolean;
  /** The item's name, shown at the top. */
  name: string;
  moduleId: number | null;
  category: Category;
  /** The sender or a rep of the chat may file it for everyone there. */
  canTag?: boolean;
  saveLabel?: string;
  onClose: () => void;
  /** Returns an error message, or null when done. */
  onSave: (moduleId: number, category: Category, forEveryone: boolean) => Promise<string | null>;
};

// Choose a module and a folder for a file, photo or link: this semester's modules first, earlier
// ones below.
export function OrganiseSheet(props: Props) {
  return (
    <BottomSheet visible={props.visible} title="Save to Resources" onClose={props.onClose} height={0.8}>
      {props.visible ? <OrganiseForm {...props} /> : null}
    </BottomSheet>
  );
}

function OrganiseForm({ name, moduleId, category, canTag, saveLabel, onClose, onSave }: Props) {
  const styles = useStyles();
  const { data } = useMyModules();
  const [module, setModule] = useState<number | null>(moduleId);
  const [folder, setFolder] = useState<Category>(category);
  const [everyone, setEveryone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current: ModuleCard[] = data?.batch ? data.current : [];
  const earlier: ModuleCard[] = data?.batch
    ? data.past.flatMap((p) => p.modules).filter((m) => !current.some((c) => c.id === m.id))
    : [];

  async function save() {
    if (module === null) {
      setError('Choose a module.');
      return;
    }
    setSaving(true);
    setError(null);
    const e = await onSave(module, folder, everyone);
    setSaving(false);
    if (e) setError(e);
    else onClose();
  }

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Text style={styles.name} numberOfLines={2}>
        {name}
      </Text>

      <Text style={styles.label}>Module</Text>
      {current.length === 0 && earlier.length === 0 ? (
        <Text style={styles.hint}>Set up your modules in Resources first.</Text>
      ) : null}
      <View style={styles.chips}>
        {current.map((m) => (
          <Chip key={m.id} label={m.code} a11y={`${m.code}, ${m.name}`} active={m.id === module} onPress={() => setModule(m.id)} />
        ))}
      </View>
      {earlier.length > 0 ? (
        <>
          <Text style={styles.sub}>Earlier semesters</Text>
          <View style={styles.chips}>
            {earlier.map((m) => (
              <Chip key={m.id} label={m.code} a11y={`${m.code}, ${m.name}`} active={m.id === module} onPress={() => setModule(m.id)} />
            ))}
          </View>
        </>
      ) : null}

      <Text style={styles.label}>Folder</Text>
      <View style={styles.chips}>
        {CATEGORIES.map((c) => (
          <Chip key={c.key} label={c.label} active={c.key === folder} onPress={() => setFolder(c.key)} />
        ))}
      </View>

      {canTag ? (
        <View style={styles.everyone}>
          <CheckRow label="File it for everyone in this chat" checked={everyone} onChange={setEveryone} />
          <Text style={styles.hint}>Your batchmates find it in this module straight away. Anyone can still move their own copy.</Text>
        </View>
      ) : null}

      <FormMessage message={error} />
      <Button label={saveLabel ?? 'Save'} loading={saving} onPress={save} disabled={module === null} />
    </ScrollView>
  );
}

function Chip({ label, a11y, active, onPress }: { label: string; a11y?: string; active: boolean; onPress: () => void }) {
  const styles = useStyles();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={a11y ?? label}
      style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </PressableScale>
  );
}

const useStyles = createThemedStyles((t) => ({
  body: { paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.md },
  name: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text, marginTop: space.xs },
  sub: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: t.textMuted },
  hint: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: t.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.md + 2,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: t.border,
    backgroundColor: t.surface,
  },
  // Selected: the accent with Ink text (brand rule).
  chipActive: { backgroundColor: brand.accent, borderColor: brand.accent },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  chipTextActive: { color: brand.ink },
  everyone: { gap: space.xs, marginTop: space.xs },
}));
