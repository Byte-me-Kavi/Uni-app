import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { savePhoneContact } from '@/lib/chat/attachments';
import { startDirect } from '@/lib/chat/engine';
import { openChat } from '@/lib/chat/open-chat';
import type { ContactAttachment } from '@/lib/chat/types';
import { createThemedStyles, fonts, space } from '@/theme/tokens';

// A shared contact. A student opens their card and can be messaged in a tap; a phone contact can
// be called or saved to the phone's contacts.
export function ContactMessage({ contact, mine }: { contact: ContactAttachment; mine: boolean }) {
  const styles = useStyles();
  const [busy, setBusy] = useState(false);

  if (contact.type === 'student') {
    const openCard = () => router.push({ pathname: '/people/[id]', params: { id: contact.user_id } });
    async function message() {
      if (contact.type !== 'student') return;
      setBusy(true);
      const result = await startDirect({ user_id: contact.user_id, full_name: contact.name, avatar_path: contact.avatar_path });
      setBusy(false);
      const conversationId = 'conversationId' in result ? result.conversationId : undefined;
      if (conversationId) openChat(conversationId);
      else openCard(); // their card explains why (for example, who can message them)
    }
    return (
      <View>
        <Pressable onPress={openCard} accessibilityRole="button" accessibilityLabel={`${contact.name}, ${contact.institution}. View profile`} style={styles.head}>
          <Avatar name={contact.name} path={contact.avatar_path} size={44} />
          <View style={styles.text}>
            <Text style={styles.name} numberOfLines={1}>
              {contact.name}
            </Text>
            <Text style={styles.detail} numberOfLines={1}>
              Student · {contact.institution}
            </Text>
          </View>
        </Pressable>
        <View style={styles.actions}>
          <Action label="View profile" onPress={openCard} />
          {!mine ? <Action label={busy ? 'Opening…' : 'Message'} onPress={message} disabled={busy} /> : null}
        </View>
      </View>
    );
  }

  const first = contact.phones[0];
  return (
    <View>
      <View style={styles.head} accessible accessibilityLabel={`Contact ${contact.name}, ${contact.phones.map((p) => p.number).join(', ')}`}>
        <Avatar name={contact.name} path={null} size={44} />
        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={1}>
            {contact.name}
          </Text>
          {contact.phones.map((p, i) => (
            <Text key={i} style={styles.detail} numberOfLines={1} selectable>
              {p.number}
              {p.label ? ` · ${p.label}` : ''}
            </Text>
          ))}
        </View>
      </View>
      <View style={styles.actions}>
        <Action label="Call" onPress={() => Linking.openURL(`tel:${first.number.replace(/[^+0-9]/g, '')}`)} />
        {Platform.OS !== 'web' ? <Action label="Save contact" onPress={() => savePhoneContact(contact).catch(() => {})} /> : null}
      </View>
    </View>
  );
}

function Action({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const useStyles = createThemedStyles((t) => ({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  text: { flex: 1, gap: 1 },
  name: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  detail: { fontFamily: fonts.body, fontSize: 13.5, color: t.textMuted },
  actions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: t.border,
    marginTop: space.sm,
    marginHorizontal: -space.md,
  },
  action: { flex: 1, alignItems: 'center', paddingVertical: space.sm + 2 },
  pressed: { opacity: 0.6 },
  actionText: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
}));
