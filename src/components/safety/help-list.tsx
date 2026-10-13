import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { EnvelopeSimpleIcon } from 'phosphor-react-native/src/icons/EnvelopeSimple';
import { LinkIcon } from 'phosphor-react-native/src/icons/Link';
import { PhoneIcon } from 'phosphor-react-native/src/icons/Phone';

import { PressableScale } from '@/components/ui/pressable-scale';
import { KIND_TITLE, loadHelpContacts, type Contact, type ContactKind, type HelpContacts } from '@/lib/help';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

const ORDER: ContactKind[] = ['emergency', 'ragging', 'security', 'wellbeing'];

// Help contacts grouped by what they are for, each one tap to call, email or open. `kinds` limits
// the list (after a ragging report: emergency and ragging).
export function HelpList({ kinds = ORDER, onLoaded }: { kinds?: ContactKind[]; onLoaded?: (h: HelpContacts) => void }) {
  const theme = useTheme();
  const styles = useStyles();
  const [help, setHelp] = useState<HelpContacts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadHelpContacts().then((r) => {
      if (r.data) {
        setHelp(r.data);
        onLoaded?.(r.data);
      } else setError(r.error);
    });
    // Once, when shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!help) {
    return error ? <Text style={styles.note}>{error}</Text> : <ActivityIndicator color={theme.accentText} />;
  }

  // The university's own first in each group, then the national ones.
  const all: (Contact & { local: boolean })[] = [
    ...help.university_contacts.map((c) => ({ ...c, local: true })),
    ...help.national.map((c) => ({ ...c, local: false })),
  ];

  return (
    <View style={styles.stack}>
      {kinds.map((kind) => {
        const list = all.filter((c) => c.kind === kind);
        if (list.length === 0) {
          return kind === 'ragging' ? (
            <View key={kind} style={styles.group}>
              <Text style={styles.heading}>{KIND_TITLE[kind]}</Text>
              <Text style={styles.note}>
                {help.university ?? 'Your university'}&apos;s own contacts are not listed yet. Report it in the app and the Uni
                Era team will help you reach the right people.
              </Text>
            </View>
          ) : null;
        }
        return (
          <View key={kind} style={styles.group}>
            <Text style={styles.heading}>{KIND_TITLE[kind]}</Text>
            {list.map((c, i) => (
              <ContactRow key={`${c.label}${i}`} contact={c} university={c.local ? help.university : null} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

function ContactRow({ contact, university }: { contact: Contact; university: string | null }) {
  const theme = useTheme();
  const styles = useStyles();
  const open = contact.phone ? `tel:${contact.phone}` : contact.email ? `mailto:${contact.email}` : contact.url!;
  const Icon = contact.phone ? PhoneIcon : contact.email ? EnvelopeSimpleIcon : LinkIcon;
  const shown = contact.phone ?? contact.email ?? contact.url?.replace(/^https:\/\//, '');
  return (
    <PressableScale
      onPress={() => Linking.openURL(open).catch(() => {})}
      accessibilityRole="button"
      accessibilityLabel={`${contact.label}, ${shown}`}
      style={[styles.row, contact.kind === 'emergency' && styles.rowUrgent]}>
      <View style={[styles.icon, contact.kind === 'emergency' && styles.iconUrgent]}>
        <Icon size={20} weight="fill" color={contact.kind === 'emergency' ? '#FFFFFF' : theme.onAccentTint} />
      </View>
      <View style={styles.text}>
        <Text style={styles.label}>{contact.label}</Text>
        <Text style={styles.value}>
          {shown}
          {university ? `, ${university}` : ''}
        </Text>
        {contact.note ? <Text style={styles.note}>{contact.note}</Text> : null}
      </View>
    </PressableScale>
  );
}

const useStyles = createThemedStyles((t) => ({
  stack: { gap: space.lg },
  group: { gap: space.sm },
  heading: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.textMuted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    padding: space.md,
  },
  rowUrgent: { borderWidth: 1.5, borderColor: '#BE123C' },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconUrgent: { backgroundColor: '#BE123C' },
  text: { flex: 1, gap: 1 },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  value: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: t.textMuted },
  note: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: t.textMuted },
}));
