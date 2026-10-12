import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { FlatList, Keyboard, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { AddressBookIcon } from 'phosphor-react-native/src/icons/AddressBook';
import { CameraIcon } from 'phosphor-react-native/src/icons/Camera';
import { ChartBarHorizontalIcon } from 'phosphor-react-native/src/icons/ChartBarHorizontal';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { FileTextIcon } from 'phosphor-react-native/src/icons/FileText';
import { ImagesIcon } from 'phosphor-react-native/src/icons/Images';
import { KeyboardIcon } from 'phosphor-react-native/src/icons/Keyboard';
import { PaperPlaneRightIcon } from 'phosphor-react-native/src/icons/PaperPlaneRight';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { SmileyIcon } from 'phosphor-react-native/src/icons/Smiley';
import { StudentIcon } from 'phosphor-react-native/src/icons/Student';

import { AttachMenu, type AttachOption } from '@/components/chat/attach-menu';
import { AttachPreview, type Pending } from '@/components/chat/attach-preview';
import { LinkCard } from '@/components/chat/link-card';
import { PollComposer } from '@/components/chat/poll-composer';
import { ReplyQuote } from '@/components/chat/reply-quote';
import { StickerTray } from '@/components/chat/sticker-tray';
import { StudentPicker } from '@/components/chat/student-picker';
import type { RecordingState } from '@/components/chat/voice-recorder';
import { Avatar } from '@/components/ui/avatar';
import { PressableScale } from '@/components/ui/pressable-scale';
import { canPickPhoneContact, pickDocument, pickPhoneContact, pickPhoto, pickPhotos } from '@/lib/chat/attachments';
import { editMessage, notifyTyping, sendMessage, sendRich } from '@/lib/chat/engine';
import { uuidv7 } from '@/lib/chat/uuid';
import { tagMessage } from '@/lib/chat-folders';
import { markUsed } from '@/lib/chat/sticker-library';
import type { Chat, LinkPreview, Message, VoiceAttachment } from '@/lib/chat/types';
import { voiceAvailable } from '@/lib/chat/voice';
import { supabase } from '@/lib/supabase';
import { brand, createThemedStyles, fonts, space, useTheme } from '@/theme/tokens';

// Hold-to-record needs expo-audio, which builds made before it existed do not have.
const VoiceRecorder: ComponentType<{
  onRecorded: (voice: VoiceAttachment) => void;
  onState: (state: RecordingState) => void;
  onError: (message: string) => void;
}> | null = voiceAvailable() && Platform.OS !== 'web' ? require('@/components/chat/voice-recorder').VoiceRecorder : null;

type Member = { user_id: string; full_name: string; avatar_path: string | null };

// When you last sent in each chat, for slow mode.
const lastSent = new Map<string, number>();
const waitText = (seconds: number) =>
  seconds >= 60 ? `${Math.ceil(seconds / 60)} ${Math.ceil(seconds / 60) === 1 ? 'minute' : 'minutes'}` : `${seconds} seconds`;
const URL_PATTERN = /https?:\/\/[^\s]+/;

type Props = {
  chat: Chat | null;
  conversationId: string;
  me: string | null;
  replyTo: Message | null;
  onCancelReply: () => void;
  editing: Message | null;
  onCancelEdit: () => void;
  onError: (message: string | null) => void;
};

// The message box. Writes, replies, edits; "+" for photos, documents, polls and contacts; the
// sticker drawer; hold the mic for a voice note. In groups, "@" suggests members to mention. A
// link gets a preview (made here, so the people receiving it never contact the site).
export function Composer({ chat, conversationId, me, replyTo, onCancelReply, editing, onCancelEdit, onError }: Props) {
  const theme = useTheme();
  const styles = useStyles();
  const inputRef = useRef<TextInput>(null);
  // Where the cursor is, so an emoji from the tray goes in at that point.
  const selection = useRef({ start: 0, end: 0 });
  const [draft, setDraft] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  // The pop-ups mount the first time they are needed, not with every chat: opening a chat stays
  // light. The attach menu then stays mounted, as iOS runs the chosen action when it closes.
  const [attachUsed, setAttachUsed] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [pollOpen, setPollOpen] = useState(false);
  const [studentOpen, setStudentOpen] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [link, setLink] = useState<LinkPreview | null>(null);
  const [dismissedLink, setDismissedLink] = useState<string | null>(null);
  const [mentions, setMentions] = useState<Member[]>([]);
  const [suggestions, setSuggestions] = useState<Member[]>([]);
  const group = !!chat && chat.kind !== 'direct';
  // Slow mode (groups, for members; reps and admins are exempt). The server enforces it; here the
  // student is told how long to wait, instead of a message failing.
  const slow = group && chat?.my_role !== 'admin' ? (chat?.slow_mode_seconds ?? 0) : 0;
  function allowed() {
    if (!slow) return true;
    const left = Math.ceil(((lastSent.get(conversationId) ?? 0) + slow * 1000 - Date.now()) / 1000);
    if (left > 0) {
      onError(`Slow mode is on. You can send again in ${waitText(left)}.`);
      return false;
    }
    lastSent.set(conversationId, Date.now());
    return true;
  }
  const postText: typeof sendMessage = (...args) => (allowed() ? sendMessage(...args) : Promise.resolve());
  const postRich: typeof sendRich = (...args) => (allowed() ? sendRich(...args) : Promise.resolve());

  // Editing: the box takes the message's text.
  useEffect(() => {
    if (editing) {
      setDraft(editing.body ?? '');
      inputRef.current?.focus();
    }
  }, [editing]);
  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  // A preview for the first link, once typing pauses.
  const url = editing ? null : (URL_PATTERN.exec(draft)?.[0] ?? null);
  useEffect(() => {
    if (!url || url === dismissedLink) {
      setLink(null);
      return;
    }
    if (link?.url === url) return;
    let live = true;
    const timer = setTimeout(async () => {
      const { data } = await supabase.functions.invoke('link-preview', { body: { url }, timeout: 8000 }).catch(() => ({ data: null }));
      if (live) setLink((data as { preview: LinkPreview | null } | null)?.preview ?? null);
    }, 700);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [url, dismissedLink]);

  // "@" in a group: members whose name starts with what follows.
  const mentionQuery = group ? (/(?:^|\s)@([^\s@]{0,30})$/.exec(draft)?.[1] ?? null) : null;
  useEffect(() => {
    if (mentionQuery === null) {
      setSuggestions([]);
      return;
    }
    let live = true;
    const prefix = mentionQuery ? mentionQuery[0].toUpperCase() + mentionQuery.slice(1) : '';
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc('chat_members', {
        p_conversation_id: conversationId,
        p_limit: 20,
        ...(prefix ? { p_after_name: prefix, p_after_id: '00000000-0000-0000-0000-000000000000' } : {}),
      });
      if (!live) return;
      const rows = ((data ?? []) as Member[]).filter(
        (m) => m.user_id !== me && m.full_name.toLowerCase().startsWith(mentionQuery.toLowerCase()),
      );
      setSuggestions(rows.slice(0, 5));
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [mentionQuery, conversationId, me]);

  function mention(member: Member) {
    setDraft((d) => d.replace(/@([^\s@]{0,30})$/, `@${member.full_name} `));
    setMentions((m) => (m.some((x) => x.user_id === member.user_id) ? m : [...m, member]));
    setSuggestions([]);
  }

  function reset() {
    setDraft('');
    setLink(null);
    setDismissedLink(null);
    setMentions([]);
  }

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    onError(null);
    if (editing) {
      const failed = await editMessage(conversationId, editing, text);
      if (failed) onError(failed);
      onCancelEdit();
      reset();
      return;
    }
    postText(conversationId, text, {
      replyTo,
      // Only people still named in the text.
      mentions: mentions.filter((m) => text.includes(`@${m.full_name}`)).map((m) => m.user_id),
      link: link && text.includes(link.url) ? link : null,
    });
    onCancelReply();
    reset();
  }, [draft, editing, replyTo, mentions, link, conversationId]);

  // Picking runs after the sheet has closed; a cancelled picker changes nothing.
  async function pick<T>(run: () => Promise<{ ok: T } | { error: string } | null>, then: (value: T) => void, failure: string) {
    onError(null);
    try {
      const picked = await run();
      if (!picked) return;
      if ('error' in picked) onError(picked.error);
      else then(picked.ok);
    } catch {
      onError(failure);
    }
  }

  // Each choice has its own colour so it is found by sight, as in WhatsApp. Glyphs are white on
  // the darker circles and Ink on red, amber and the accent.
  const attachOptions: AttachOption[] = [
    {
      key: 'gallery',
      label: 'Gallery',
      Icon: ImagesIcon,
      tint: '#7A5AF8',
      glyph: brand.white,
      onPress: () => pick(pickPhotos, (photos) => setPending({ kind: 'image', photos }), 'Could not open those photos.'),
    },
    ...(Platform.OS !== 'web'
      ? [
          {
            key: 'camera',
            label: 'Camera',
            Icon: CameraIcon,
            tint: brand.danger, // a warm colour among the blues, as in WhatsApp
            glyph: brand.ink,
            onPress: () => pick(() => pickPhoto('camera'), (photo) => setPending({ kind: 'image', photos: [photo] }), 'Could not take a photo.'),
          },
        ]
      : []),
    {
      key: 'document',
      label: 'Document',
      Icon: FileTextIcon,
      tint: '#3B6FE0',
      glyph: brand.white,
      onPress: () => pick(pickDocument, (attachment) => setPending({ kind: 'file', attachment }), 'Could not open that file.'),
    },
    { key: 'poll', label: 'Poll', Icon: ChartBarHorizontalIcon, tint: '#F5A524', glyph: brand.ink, onPress: () => setPollOpen(true) },
    { key: 'student', label: 'Student', Icon: StudentIcon, tint: '#12855E', glyph: brand.white, onPress: () => setStudentOpen(true) },
    ...(canPickPhoneContact
      ? [
          {
            key: 'contact',
            label: 'Contact',
            Icon: AddressBookIcon,
            tint: '#1B87A6',
            glyph: brand.white,
            onPress: () =>
              pick(pickPhoneContact, (contact) => postRich(conversationId, 'contact', contact, '', { replyTo }), 'Could not open your contacts.'),
          },
        ]
      : []),
  ];

  // Emoji from the tray are typed text, inserted where the cursor is.
  function insertEmoji(emoji: string) {
    const { start, end } = selection.current;
    const at = Math.min(start, draft.length);
    setDraft(draft.slice(0, at) + emoji + draft.slice(Math.min(end, draft.length)));
    selection.current = { start: at + emoji.length, end: at + emoji.length };
    notifyTyping(conversationId);
  }

  function backspace() {
    const at = Math.min(selection.current.start, draft.length);
    const before = dropLastCharacter(draft.slice(0, at));
    setDraft(before + draft.slice(at));
    selection.current = { start: before.length, end: before.length };
  }

  function toggleStickers() {
    if (stickersOpen) {
      setStickersOpen(false);
      inputRef.current?.focus();
    } else {
      Keyboard.dismiss();
      setStickersOpen(true);
    }
  }

  const empty = !draft.trim();
  const showMic = empty && !editing && !!VoiceRecorder;

  return (
    <View>
      {slow ? (
        <Text style={styles.slowNote} accessibilityLiveRegion="polite">
          Slow mode: one message every {waitText(slow).replace(/^1 minute$/, 'minute')}
        </Text>
      ) : null}
      {suggestions.length ? (
        <FlatList
          data={suggestions}
          keyExtractor={(m) => m.user_id}
          keyboardShouldPersistTaps="always"
          style={styles.suggestions}
          renderItem={({ item }) => (
            <Pressable onPress={() => mention(item)} accessibilityRole="button" accessibilityLabel={`Mention ${item.full_name}`} style={styles.suggestion}>
              <Avatar name={item.full_name} path={item.avatar_path} size={32} />
              <Text style={styles.suggestionText} numberOfLines={1}>
                {item.full_name}
              </Text>
            </Pressable>
          )}
        />
      ) : null}

      {replyTo || editing || (link && !editing) ? (
        <View style={styles.context}>
          {editing ? (
            <ReplyQuote
              reply={{ id: editing.id, sender_id: me, sender_name: null, kind: editing.kind, text: editing.body }}
              me={me}
              label="Edit message"
              onCancel={() => {
                onCancelEdit();
                reset();
              }}
            />
          ) : replyTo ? (
            <ReplyQuote
              reply={{
                id: replyTo.id,
                sender_id: replyTo.sender_id,
                sender_name: replyTo.sender_name,
                kind: replyTo.kind,
                text: replyTo.kind === 'text' ? replyTo.body : (replyTo.body ?? replyTo.kind),
              }}
              me={me}
              onCancel={onCancelReply}
            />
          ) : null}
          {link && !editing ? <LinkCard link={link} onRemove={() => setDismissedLink(link.url)} /> : null}
        </View>
      ) : null}

      <View style={styles.composer}>
        {/* While recording, the recorder's own bar fills the row. */}
        {recording ? null : (
          <>
            {!editing ? (
              <PressableScale
                onPress={() => {
                  // The menu opens from the bottom: the keyboard goes first, or it would cover it.
                  Keyboard.dismiss();
                  setStickersOpen(false);
                  setAttachUsed(true);
                  setAttachOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Attach photos, a document, a poll or a contact"
                style={styles.attach}>
                <PlusIcon size={22} weight="bold" color={theme.text} />
              </PressableScale>
            ) : null}
            <View style={styles.inputWrap}>
              <TextInput
                ref={inputRef}
                onFocus={() => setStickersOpen(false)}
                value={draft}
                onSelectionChange={(e) => (selection.current = e.nativeEvent.selection)}
                onChangeText={(text) => {
                  setDraft(text);
                  if (text) notifyTyping(conversationId);
                }}
                placeholder={editing ? 'Edit message' : 'Message'}
                placeholderTextColor={theme.textMuted}
                multiline
                maxLength={4000}
                style={styles.input}
                selectionColor={theme.accent}
                cursorColor={theme.accent}
                accessibilityLabel="Message"
              />
              {!editing ? (
                <PressableScale
                  onPress={toggleStickers}
                  accessibilityRole="button"
                  accessibilityLabel={stickersOpen ? 'Show keyboard' : 'Emoji and stickers'}
                  hitSlop={6}
                  style={styles.stickerButton}>
                  {stickersOpen ? (
                    <KeyboardIcon size={22} color={theme.textMuted} weight="bold" />
                  ) : (
                    <SmileyIcon size={23} color={theme.textMuted} weight="bold" />
                  )}
                </PressableScale>
              ) : null}
            </View>
          </>
        )}
        {showMic && VoiceRecorder ? (
          <VoiceRecorder
            onState={(state) => setRecording(state.recording)}
            onError={(message) => onError(message)}
            onRecorded={(voice) => {
              postRich(conversationId, 'voice', voice, '', { replyTo });
              onCancelReply();
            }}
          />
        ) : (
          <PressableScale
            onPress={send}
            disabled={empty}
            accessibilityRole="button"
            accessibilityLabel={editing ? 'Save edit' : 'Send'}
            style={[styles.send, empty && styles.sendIdle]}>
            {editing ? (
              <CheckIcon size={22} weight="bold" color={empty ? theme.textMuted : theme.onAccent} />
            ) : (
              <PaperPlaneRightIcon size={20} weight="fill" color={empty ? theme.textMuted : theme.onAccent} />
            )}
          </PressableScale>
        )}
      </View>

      {stickersOpen ? (
        <StickerTray
          onPick={(sticker) => {
            onError(null);
            markUsed(`${sticker.pack}:${sticker.id}`);
            postRich(conversationId, 'sticker', sticker, '', { replyTo });
            onCancelReply();
          }}
          onEmoji={insertEmoji}
          onBackspace={backspace}
        />
      ) : null}

      {attachUsed ? <AttachMenu visible={attachOpen} options={attachOptions} onClose={() => setAttachOpen(false)} /> : null}
      {pending ? (
        <AttachPreview
          pending={pending}
          // Course and kuppi chats already file into their module.
          fileable={!!chat && chat.kind !== 'module' && chat.kind !== 'kuppi'}
          onChange={setPending}
          onClose={() => setPending(null)}
          onSend={(caption, moduleId) => {
            if (pending?.kind === 'image') {
              pending.photos.forEach((photo, i) => postRich(conversationId, 'image', photo, i === 0 ? caption : '', { replyTo: i === 0 ? replyTo : null }));
            } else if (pending) {
              const id = uuidv7();
              postRich(conversationId, 'file', pending.attachment, caption, { replyTo, id });
              // Recorded now, applied when the upload reaches the server.
              if (moduleId) tagMessage(conversationId, id, moduleId).then((e) => e && onError(e));
            }
            onCancelReply();
            setPending(null);
          }}
        />
      ) : null}
      {pollOpen ? (
        <PollComposer
          visible={pollOpen}
          onClose={() => setPollOpen(false)}
          onSend={(poll) => {
            setPollOpen(false);
            postRich(conversationId, 'poll', poll, '', { replyTo });
            onCancelReply();
          }}
        />
      ) : null}
      {studentOpen ? (
        <StudentPicker
          visible={studentOpen}
          onClose={() => setStudentOpen(false)}
          onPick={(person) => {
            setStudentOpen(false);
            postRich(
              conversationId,
              'contact',
              { type: 'student', user_id: person.user_id, name: person.full_name, avatar_path: person.avatar_path, institution: person.institution },
              '',
              { replyTo },
            );
            onCancelReply();
          }}
        />
      ) : null}
    </View>
  );
}

// One character back, treating an emoji as one character, as a keyboard's delete key does: skin
// tones, variation selectors, keycaps, joined emoji (👩‍💻, 🏳️‍🌈) and flags (🇱🇰) go as one.
function dropLastCharacter(text: string) {
  const chars = Array.from(text);
  const extender = /^[\u200D\uFE0E\uFE0F\u20E3\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]$/u;
  const flagHalf = /^[\u{1F1E6}-\u{1F1FF}]$/u;
  const dropOne = () => {
    while (chars.length && extender.test(chars[chars.length - 1])) chars.pop();
    let halves = 0;
    for (let i = chars.length - 1; i >= 0 && flagHalf.test(chars[i]); i--) halves++;
    chars.splice(chars.length - (halves > 0 && halves % 2 === 0 ? 2 : 1));
  };
  dropOne();
  while (chars.length && chars[chars.length - 1] === '\u200D') {
    chars.pop();
    dropOne();
  }
  return chars.join('');
}

const useStyles = createThemedStyles((t) => ({
  slowNote: { fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: t.textMuted, textAlign: 'center', paddingTop: space.xs },
  suggestions: { maxHeight: 220, backgroundColor: t.elevated, borderTopWidth: 1, borderTopColor: t.border },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  suggestionText: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  context: { gap: space.sm, paddingHorizontal: space.md, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: t.border },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.xs + 2,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderTopWidth: 1,
    borderTopColor: t.border,
    backgroundColor: t.background,
  },
  attach: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', borderRadius: 22, backgroundColor: t.surface },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    paddingLeft: space.lg,
    paddingRight: space.xs,
    paddingTop: 11,
    paddingBottom: 11,
    fontFamily: fonts.body,
    fontSize: 16,
    color: t.text,
  },
  stickerButton: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  sendIdle: { backgroundColor: t.surface },
}));

