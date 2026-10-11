import { useState } from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { XIcon } from 'phosphor-react-native/src/icons/X';

import { ModalScreen } from '@/components/chat/modal-screen';
import { PressableScale } from '@/components/ui/pressable-scale';
import type { PollAttachment } from '@/lib/chat/types';
import { brand, createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

const MAX_OPTIONS = 12;

// Writing a poll: a question, 2 to 12 options, and whether students may pick more than one.
export function PollComposer({ visible, onClose, onSend }: { visible: boolean; onClose: () => void; onSend: (poll: PollAttachment) => void }) {
  const theme = useTheme();
  const styles = useStyles();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const duplicate = new Set(filled.map((o) => o.toLowerCase())).size !== filled.length;
  const ready = question.trim().length > 0 && filled.length >= 2 && !duplicate;

  function reset() {
    setQuestion('');
    setOptions(['', '']);
    setMultiple(false);
  }

  function send() {
    if (!ready) return;
    onSend({ question: question.trim(), options: filled, multiple });
    reset();
  }

  function setOption(index: number, text: string) {
    setOptions((current) => {
      const next = current.map((o, i) => (i === index ? text : o));
      // A new empty row appears as you fill the last one, like most poll makers.
      if (index === next.length - 1 && text.trim() && next.length < MAX_OPTIONS) next.push('');
      return next;
    });
  }

  return (
    <ModalScreen visible={visible} title="New poll" onClose={onClose} action={{ label: 'Send', onPress: send, disabled: !ready }}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Question</Text>
        <TextInput
          value={question}
          onChangeText={setQuestion}
          placeholder="Which day suits everyone for the kuppi?"
          placeholderTextColor={theme.textMuted}
          maxLength={300}
          multiline
          autoFocus
          style={[styles.input, styles.question]}
          selectionColor={brand.accent}
          cursorColor={brand.accent}
          accessibilityLabel="Question"
        />

        <Text style={styles.label}>Options</Text>
        <View style={styles.options}>
          {options.map((option, i) => (
            <View key={i} style={styles.optionRow}>
              <TextInput
                value={option}
                onChangeText={(text) => setOption(i, text)}
                placeholder={`Option ${i + 1}`}
                placeholderTextColor={theme.textMuted}
                maxLength={100}
                style={[styles.input, styles.option]}
                selectionColor={brand.accent}
                cursorColor={brand.accent}
                accessibilityLabel={`Option ${i + 1}`}
              />
              {options.length > 2 ? (
                <PressableScale
                  onPress={() => setOptions((current) => current.filter((_, j) => j !== i))}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove option ${i + 1}`}
                  hitSlop={8}
                  style={styles.remove}>
                  <XIcon size={18} color={theme.textMuted} weight="bold" />
                </PressableScale>
              ) : null}
            </View>
          ))}
        </View>
        {duplicate ? <Text style={styles.error}>Two options are the same.</Text> : null}

        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.switchLabel}>Allow more than one answer</Text>
            <Text style={styles.switchDetail}>Students can tick several options.</Text>
          </View>
          <Switch
            value={multiple}
            onValueChange={setMultiple}
            trackColor={{ true: theme.accentText, false: theme.borderFilled }}
            thumbColor={brand.white}
            accessibilityLabel="Allow more than one answer"
          />
        </View>
      </ScrollView>
    </ModalScreen>
  );
}

const useStyles = createThemedStyles((t) => ({
  content: { padding: space.xl, gap: space.sm, width: '100%', maxWidth: 560, alignSelf: 'center' },
  label: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted, marginTop: space.md },
  input: {
    backgroundColor: t.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontFamily: fonts.body,
    fontSize: 16,
    color: t.text,
  },
  question: { minHeight: 56, fontFamily: fonts.bodySemiBold },
  options: { gap: space.sm },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  option: { flex: 1 },
  remove: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  error: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.dangerText },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xl },
  switchText: { flex: 1, gap: 2 },
  switchLabel: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  switchDetail: { fontFamily: fonts.body, fontSize: 14, color: t.textMuted },
}));
