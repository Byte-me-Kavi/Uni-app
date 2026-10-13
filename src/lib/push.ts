import Constants from 'expo-constants';
import * as Device from 'expo-device';
import type * as NotificationsModule from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import { currentConversationId } from '@/lib/chat/engine';
import { supabase } from '@/lib/supabase';
import { brand } from '@/theme/tokens';

// Push notifications for when the app is closed. The phone gets an Expo push token, which we keep
// in Supabase (api.register_push_token); the database asks the `push` Edge Function to notify
// people when a message arrives. Needs a development or store build: Expo Go cannot receive them,
// and neither can the web app or a simulator.

export type PushStatus = 'unsupported' | 'granted' | 'undetermined' | 'denied';

const inExpoGo = Constants.executionEnvironment === 'storeClient';
const supported = Platform.OS !== 'web' && !inExpoGo && Device.isDevice;
const projectId: string | undefined = Constants.expoConfig?.extra?.eas?.projectId;

// Loaded only where it works: in Expo Go on Android, importing expo-notifications throws, which
// took the whole signed-in app down with it. Everything below checks `supported` first.
const Notifications: typeof NotificationsModule = supported ? require('expo-notifications') : (null as never);
export { Notifications };

let token: string | null = null;

if (supported) {
  // While the app is open: stay quiet for the chat on screen (its messages are already there);
  // show the rest as a normal banner.
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const id = notification.request.content.data?.conversation_id;
      const onScreen = typeof id === 'string' && id === currentConversationId();
      return { shouldShowBanner: !onScreen, shouldShowList: !onScreen, shouldPlaySound: !onScreen, shouldSetBadge: true };
    },
  });
}

// Buttons on message notifications: reply without opening the app, or mark the chat read. The
// server sends message notifications with categoryId "message".
async function ensureCategories() {
  await Notifications.setNotificationCategoryAsync('message', [
    {
      identifier: 'reply',
      buttonTitle: 'Reply',
      textInput: { submitButtonTitle: 'Send', placeholder: 'Message' },
      options: { opensAppToForeground: false },
    },
    { identifier: 'read', buttonTitle: 'Mark as read', options: { opensAppToForeground: false } },
  ]);
}

async function ensureChannel() {
  await ensureCategories().catch(() => {});
  if (Platform.OS !== 'android') return;
  // The server sends with channelId "messages". Students can change its sound or turn it off in
  // the phone's settings, separately from future channels such as events.
  await Notifications.setNotificationChannelAsync('messages', {
    name: 'Messages',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 120, 200],
    lightColor: brand.accent,
    showBadge: true,
  });
  // Orders, confirmed payments, new merch and interest in an item: its own channel, so students can
  // turn shop notifications off without muting chats.
  // A kuppi you asked for is being hosted (and later, kuppi reminders).
  await Notifications.setNotificationChannelAsync('kuppi', {
    name: 'Kuppi',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: brand.accent,
    showBadge: false,
  });
  await Notifications.setNotificationChannelAsync('exams', {
    name: 'Exams and deadlines',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: brand.accent,
    showBadge: false,
  });
  await Notifications.setNotificationChannelAsync('files', {
    name: 'Your shared files',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: brand.accent,
    showBadge: false,
  });
  await Notifications.setNotificationChannelAsync('account', {
    name: 'Account',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: brand.accent,
    showBadge: false,
  });
  await Notifications.setNotificationChannelAsync('shop', {
    name: 'Shop',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: brand.accent,
    showBadge: false,
  });
  // Comments and replies on your posts, likes (at most once an hour a post), and moderators' news.
  await Notifications.setNotificationChannelAsync('feed', {
    name: 'Posts and comments',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: brand.accent,
    showBadge: false,
  });
}

export async function pushStatus(): Promise<PushStatus> {
  if (!supported) return 'unsupported';
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return 'granted';
  return status === 'undetermined' || canAskAgain ? 'undetermined' : 'denied';
}

/** Saves this phone's token for the signed-in student. Silent; only runs once permission is given. */
export async function registerPush() {
  if (!supported || !projectId) return;
  if ((await Notifications.getPermissionsAsync()).status !== 'granted') return;
  await ensureChannel();
  const next = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const { error } = await supabase.rpc('register_push_token', { p_token: next, p_platform: Platform.OS });
  if (error) throw error;
  token = next;
}

/** Asks the phone for permission (the system prompt), then registers. True if notifications are on. */
export async function enablePush(): Promise<boolean> {
  if (!supported) return false;
  await ensureChannel(); // Android 13+ shows the prompt only once a channel exists
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return false;
  await registerPush().catch((error) => console.warn('[push] could not register', error));
  return true;
}

/** Before signing out: this phone stops getting that account's messages. */
export async function unregisterPush() {
  if (!token) return;
  await supabase.rpc('unregister_push_token', { p_token: token });
  token = null;
}

export const openPhoneSettings = () => Linking.openSettings();

/** The number on the app icon: unread messages, as on the Chats tab. While the app is closed the
 * server sets it with each notification. On Android it shows on launchers that support counts
 * (Samsung, Xiaomi, Oppo and others); the rest show a dot while notifications are unread. */
export function setAppBadge(count: number) {
  if (!supported) return;
  Notifications.setBadgeCountAsync(Math.max(0, count)).catch(() => {});
}

/** Opening a chat clears its notifications from the tray, like other messaging apps. */
export async function dismissChatNotifications(conversationId: string) {
  if (!supported) return;
  const shown = await Notifications.getPresentedNotificationsAsync();
  await Promise.all(
    shown
      .filter((n) => n.request.content.data?.conversation_id === conversationId)
      .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
  );
}

/** The chat a tapped notification is about. */
export function conversationOf(response: NotificationsModule.NotificationResponse | null): string | null {
  const id = response?.notification.request.content.data?.conversation_id;
  return typeof id === 'string' ? id : null;
}

// Screens a notification may open (its data carries the link). Anything else is ignored.
const SCREENS =
  /^\/(kuppi\/[0-9a-f-]{36}|shop\/(orders\/)?[0-9a-f-]{36}|shop\/leads|resource\/[0-9a-f-]{36}|module\/\d{1,12}|post\/\d{1,15}|exams)?$/;

/** The screen a tapped notification opens ("/kuppi/<id>", "/exams", "/" for Home). */
export function hrefOf(response: NotificationsModule.NotificationResponse | null): string | null {
  const href = response?.notification.request.content.data?.href;
  return typeof href === 'string' && SCREENS.test(href) ? href : null;
}

/** The kuppi a tapped notification is about. */
export function kuppiOf(response: NotificationsModule.NotificationResponse | null): string | null {
  const id = response?.notification.request.content.data?.kuppi_id;
  return typeof id === 'string' ? id : null;
}

/** The shop listing a tapped notification is about, and whether it is a new order (for the reps). */
export function shopOf(response: NotificationsModule.NotificationResponse | null): { listingId: string; order: boolean } | null {
  const data = response?.notification.request.content.data;
  if (typeof data?.listing_id !== 'string' || typeof data?.shop !== 'string') return null;
  return { listingId: data.listing_id, order: data.shop === 'order' };
}

export { supported as pushSupported };
