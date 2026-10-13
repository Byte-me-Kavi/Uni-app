import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { BellIcon } from 'phosphor-react-native/src/icons/Bell';
import { EyeIcon } from 'phosphor-react-native/src/icons/Eye';
import { StarIcon } from 'phosphor-react-native/src/icons/Star';
import { CameraIcon } from 'phosphor-react-native/src/icons/Camera';
import { ChatCircleDotsIcon } from 'phosphor-react-native/src/icons/ChatCircleDots';
import { EnvelopeSimpleIcon } from 'phosphor-react-native/src/icons/EnvelopeSimple';
import { GraduationCapIcon } from 'phosphor-react-native/src/icons/GraduationCap';
import { IdentificationBadgeIcon } from 'phosphor-react-native/src/icons/IdentificationBadge';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { FlagIcon } from 'phosphor-react-native/src/icons/Flag';
import { MegaphoneIcon } from 'phosphor-react-native/src/icons/Megaphone';
import { MoonIcon } from 'phosphor-react-native/src/icons/Moon';
import { PaletteIcon } from 'phosphor-react-native/src/icons/Palette';
import { ProhibitIcon } from 'phosphor-react-native/src/icons/Prohibit';
import { QuotesIcon } from 'phosphor-react-native/src/icons/Quotes';
import { ShieldCheckIcon } from 'phosphor-react-native/src/icons/ShieldCheck';
import { ToggleRightIcon } from 'phosphor-react-native/src/icons/ToggleRight';
import { PhoneCallIcon } from 'phosphor-react-native/src/icons/PhoneCall';
import { ScalesIcon } from 'phosphor-react-native/src/icons/Scales';
import { IdentificationCardIcon } from 'phosphor-react-native/src/icons/IdentificationCard';
import { HandshakeIcon } from 'phosphor-react-native/src/icons/Handshake';
import { DatabaseIcon } from 'phosphor-react-native/src/icons/Database';
import { LifebuoyIcon } from 'phosphor-react-native/src/icons/Lifebuoy';
import { BookOpenTextIcon } from 'phosphor-react-native/src/icons/BookOpenText';
import { ArticleIcon } from 'phosphor-react-native/src/icons/Article';
import { ChatsCircleIcon } from 'phosphor-react-native/src/icons/ChatsCircle';
import { UserCheckIcon } from 'phosphor-react-native/src/icons/UserCheck';
import { EnvelopeOpenIcon } from 'phosphor-react-native/src/icons/EnvelopeOpen';

import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';
import { ThemeSheet } from '@/components/settings/theme-sheet';
import { ActionSheet, type SheetAction } from '@/components/ui/action-sheet';
import { Avatar } from '@/components/ui/avatar';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { changePhoto, removePhoto } from '@/lib/avatar-upload';
import { signOut } from '@/lib/sign-out';
import { supabase } from '@/lib/supabase';
import { FINDABLE, labelFor, useAccount, WHO_CAN_MESSAGE } from '@/lib/use-account';
import { useHomeData } from '@/providers/home-provider';
import { APPEARANCE_OPTIONS, setAppearance, useAppearance, useThemeName } from '@/theme/appearance';
import { brand, createThemedStyles, fonts, radius, space, THEMES, useTheme } from '@/theme/tokens';
import { useIsFresher } from '@/providers/session-provider';
import { loadFreshersBadge } from '@/lib/freshers';

const ROLE_LABEL = { admin: 'Admin', moderator: 'Moderator' } as const;
const PHOTO = 104;

// Your profile as other students see it, with your settings underneath.
export default function Profile() {
  const theme = useTheme();
  const styles = useStyles();
  const fresher = useIsFresher();
  const { account, failed, reload, setAccount } = useAccount();
  // Ambassadors and moderators answer freshers' questions; the row shows how many wait.
  const [freshers, setFreshers] = useState<{ role: string; waiting: number } | null>(null);
  useEffect(() => {
    if (fresher) return;
    loadFreshersBadge().then((r) => setFreshers(r.data));
  }, [fresher]);
  const { refresh: refreshHome } = useHomeData();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const appearance = useAppearance();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const themeName = useThemeName();
  const [themeOpen, setThemeOpen] = useState(false);
  const appearanceActions: SheetAction[] = APPEARANCE_OPTIONS.map((o) => ({
    label: o.key === appearance ? `${o.label} ✓` : o.label,
    onPress: () => setAppearance(o.key),
  }));

  async function updatePhoto(run: () => ReturnType<typeof removePhoto>) {
    setPhotoError(null);
    setUploading(true);
    const result = await run().catch(() => ({
      status: 'error' as const,
      message: 'Could not update your photo. Try again.',
    }));
    setUploading(false);
    if (result.status === 'error') setPhotoError(result.message);
    if (result.status === 'done') {
      setAccount((a) => (a ? { ...a, avatar_path: result.path } : a));
      refreshHome(); // the top bar shows the new photo too
    }
  }

  const photoActions: SheetAction[] = [
    {
      label: 'Choose from library',
      onPress: () => updatePhoto(() => changePhoto('library')),
    },
    {
      label: 'Take a photo',
      onPress: () => updatePhoto(() => changePhoto('camera')),
    },
    ...(account?.avatar_path
      ? [
          {
            label: 'Remove photo',
            destructive: true,
            onPress: () => updatePhoto(removePhoto),
          },
        ]
      : []),
  ];

  async function leave() {
    setSigningOut(true);
    // Signs out this phone only and deletes this account's data from it.
    await signOut();
  }

  return (
    <Screen style={styles.screen}>
      <BackHeader title="Profile" />

      <ScrollView contentContainerStyle={styles.content}>
        {account ? (
          <View style={styles.identity}>
            <PressableScale
              onPress={() => setSheetOpen(true)}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel={account.avatar_path ? 'Change profile photo' : 'Add a profile photo'}
              style={styles.photoButton}>
              <Avatar name={account.full_name} path={account.avatar_path} size={PHOTO} />
              {uploading ? (
                <View style={styles.photoBusy}>
                  <ActivityIndicator color={brand.white} />
                </View>
              ) : null}
              {/* The accent marks the thing to do; what sits on it is Ink. */}
              <View style={styles.cameraBadge}>
                <CameraIcon size={17} weight="bold" color={theme.onAccent} />
              </View>
            </PressableScale>
            <Text style={styles.name}>{account.full_name}</Text>
            <Text style={styles.where}>{account.batch?.name ?? account.institution.name}</Text>
            {account.bio ? <Text style={styles.bio}>{account.bio}</Text> : null}
            {account.staff_role ? <Text style={styles.role}>{ROLE_LABEL[account.staff_role]}</Text> : null}
            <FormMessage message={photoError} />
          </View>
        ) : failed ? (
          <View style={styles.identity}>
            <FormMessage message="Could not load your profile. Check your connection." />
            <Button label="Try again" variant="quiet" onPress={reload} />
          </View>
        ) : (
          <View style={styles.identity} accessible accessibilityLabel="Loading">
            <View style={styles.skeletonPhoto} />
            <View style={[styles.skeletonLine, { width: '50%', height: 24 }]} />
            <View style={[styles.skeletonLine, { width: '70%' }]} />
          </View>
        )}

        <SettingsGroup title="Profile">
          <SettingsRow
            first
            Icon={QuotesIcon}
            label="About you"
            value={account?.bio ?? 'Add a line so students know who you are'}
            onPress={() => router.push('/settings/about')}
          />
          <SettingsRow
            Icon={IdentificationBadgeIcon}
            label="Name"
            value={account ? `${account.full_name}. Contact the Uni Era team to change it.` : undefined}
          />
        </SettingsGroup>

        <SettingsGroup
          title="Privacy"
          footer="Cards show your name and university to anyone who can find you; you choose who sees the rest. Never your email.">
          <SettingsRow
            first
            Icon={MagnifyingGlassIcon}
            label="Who can find me"
            value={labelFor(FINDABLE, account?.findable_by)}
            onPress={() => router.push('/settings/find')}
          />
          <SettingsRow
            Icon={ChatCircleDotsIcon}
            label="Who can message me"
            value={labelFor(WHO_CAN_MESSAGE, account?.who_can_message)}
            onPress={() => router.push('/settings/message')}
          />
          <SettingsRow
            Icon={EyeIcon}
            label="Last seen and online"
            value="Mutual, as in WhatsApp"
            onPress={() => router.push('/settings/last-seen')}
          />
          <SettingsRow
            Icon={ProhibitIcon}
            label="Blocked students"
            value={account ? (account.blocked_count === 0 ? 'None' : `${account.blocked_count}`) : undefined}
            onPress={() => router.push('/settings/blocked')}
          />
          <SettingsRow
            Icon={IdentificationCardIcon}
            label="Who sees your details"
            value="Photo, about and batch"
            onPress={() => router.push('/settings/visibility')}
          />
          <SettingsRow
            Icon={HandshakeIcon}
            label="Privacy and consent"
            value="What you agreed to, and your choices"
            onPress={() => router.push('/settings/consent')}
          />
          <SettingsRow
            Icon={DatabaseIcon}
            label="Your data"
            value="Download a copy, or delete your account"
            onPress={() => router.push('/settings/your-data')}
          />
        </SettingsGroup>

        <SettingsGroup title="Chats">
          <SettingsRow
            first
            Icon={StarIcon}
            label="Starred messages"
            value="Messages you kept from any chat"
            onPress={() => router.push('/starred')}
          />
          <SettingsRow
            Icon={BellIcon}
            label="Notifications"
            value="New messages, and what the lock screen shows"
            onPress={() => router.push('/settings/notifications')}
          />
        </SettingsGroup>

        <SettingsGroup title="Account">
          <SettingsRow first Icon={GraduationCapIcon} label="University" value={account?.institution.name} />
          <SettingsRow
            Icon={EnvelopeSimpleIcon}
            label="Email"
            value={account ? `${account.email} (only you see this)` : undefined}
          />
          {fresher ? (
            <SettingsRow
              Icon={EnvelopeOpenIcon}
              label="Fresher"
              value="Add your university email to post, use the Shop and host kuppi"
              onPress={() => router.push('/university-email')}
            />
          ) : (
            <SettingsRow Icon={ShieldCheckIcon} label="Verified student" value="Checked and approved by the Uni Era team" />
          )}
          <SettingsRow
            Icon={ScalesIcon}
            label="Your standing"
            value="Warnings and appeals"
            onPress={() => router.push('/standing')}
          />
        </SettingsGroup>

        <SettingsGroup title="Help and safety">
          <SettingsRow
            first
            Icon={LifebuoyIcon}
            label="Get help"
            value="Ragging, threats or how you feel: who to call"
            onPress={() => router.push('/help')}
          />
          <SettingsRow
            Icon={BookOpenTextIcon}
            label="Community guidelines"
            value="What is and is not allowed on Uni Era"
            onPress={() => router.push('/guidelines')}
          />
        </SettingsGroup>

        {freshers && freshers.role !== 'fresher' ? (
          <SettingsGroup title="Freshers">
            <SettingsRow
              first
              Icon={ChatsCircleIcon}
              label="Answer freshers"
              value={
                freshers.waiting > 0 ? `${freshers.waiting} waiting for an answer` : 'Questions from freshers at your university'
              }
              onPress={() => router.push('/freshers')}
            />
          </SettingsGroup>
        ) : null}

        {account?.staff_role ? (
          <SettingsGroup title={account.staff_role === 'admin' ? 'Admin' : 'Moderation'}>
            <SettingsRow
              first
              Icon={UserCheckIcon}
              label="Approvals"
              value="New students and freshers waiting to join"
              onPress={() => router.push('/admin/approvals')}
            />
            <SettingsRow
              Icon={FlagIcon}
              label="Reports"
              value="Everything students reported, ragging and threats first"
              onPress={() => router.push('/admin/reports')}
            />
            <SettingsRow
              Icon={ArticleIcon}
              label="Reported posts"
              value="Feed posts students reported, to restore or remove"
              onPress={() => router.push('/admin/posts')}
            />
            {account.staff_role === 'admin' ? (
              <SettingsRow
                Icon={MegaphoneIcon}
                label="Ads"
                value="Sponsored slides on the Home card and in the feed"
                onPress={() => router.push('/admin/ads')}
              />
            ) : null}
            {account.staff_role === 'admin' ? (
              <SettingsRow
                Icon={ToggleRightIcon}
                label="App switches"
                value="Pause a feature, set the oldest app allowed, post a notice"
                onPress={() => router.push('/admin/switches')}
              />
            ) : null}
            {account.staff_role === 'admin' ? (
              <SettingsRow
                Icon={PhoneCallIcon}
                label="Help contacts"
                value="Ragging, security and helpline numbers in Get help"
                onPress={() => router.push('/admin/help-contacts')}
              />
            ) : null}
          </SettingsGroup>
        ) : null}

        <SettingsGroup title="Display">
          <SettingsRow
            first
            Icon={MoonIcon}
            label="Appearance"
            value={appearance === 'system' ? 'Light or dark, as your phone is set' : appearance === 'dark' ? 'Dark' : 'Light'}
            onPress={() => setAppearanceOpen(true)}
          />
          <SettingsRow Icon={PaletteIcon} label="Theme" value={THEMES[themeName].label} onPress={() => setThemeOpen(true)} />
        </SettingsGroup>

        <Button label="Sign out" variant="quiet" onPress={leave} loading={signingOut} />
      </ScrollView>

      <ActionSheet
        visible={sheetOpen}
        title="Profile photo"
        message="Students see it in search, on your card and in chats."
        actions={photoActions}
        onClose={() => setSheetOpen(false)}
      />
      <ActionSheet
        visible={appearanceOpen}
        title="Appearance"
        message="Dark is easier on the eyes at night and saves battery on many phones."
        actions={appearanceActions}
        onClose={() => setAppearanceOpen(false)}
      />
      <ThemeSheet visible={themeOpen} onClose={() => setThemeOpen(false)} />
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.background },
  content: {
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.xxxl,
    gap: space.xl,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  identity: { alignItems: 'center', gap: space.xs, paddingBottom: space.sm },
  photoButton: { width: PHOTO, height: PHOTO, marginBottom: space.md },
  photoBusy: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: PHOTO / 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.accent,
    borderWidth: 3,
    borderColor: t.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontFamily: fonts.display,
    fontSize: 26,
    lineHeight: 32,
    color: t.text,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  where: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    lineHeight: 21,
    color: t.textMuted,
    textAlign: 'center',
  },
  bio: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: t.text,
    textAlign: 'center',
    marginTop: space.sm,
    maxWidth: 420,
  },
  role: {
    marginTop: space.sm,
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: t.text,
    backgroundColor: t.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  skeletonPhoto: {
    width: PHOTO,
    height: PHOTO,
    borderRadius: PHOTO / 2,
    backgroundColor: t.surface,
    marginBottom: space.md,
  },
  skeletonLine: {
    height: 16,
    borderRadius: radius.sm,
    backgroundColor: t.surface,
    marginTop: space.xs,
  },
}));
