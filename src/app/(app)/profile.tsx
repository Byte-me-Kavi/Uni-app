import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { BellIcon } from 'phosphor-react-native/src/icons/Bell';
import { CameraIcon } from 'phosphor-react-native/src/icons/Camera';
import { ChatCircleDotsIcon } from 'phosphor-react-native/src/icons/ChatCircleDots';
import { EnvelopeSimpleIcon } from 'phosphor-react-native/src/icons/EnvelopeSimple';
import { GraduationCapIcon } from 'phosphor-react-native/src/icons/GraduationCap';
import { IdentificationBadgeIcon } from 'phosphor-react-native/src/icons/IdentificationBadge';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { MoonIcon } from 'phosphor-react-native/src/icons/Moon';
import { ProhibitIcon } from 'phosphor-react-native/src/icons/Prohibit';
import { QuotesIcon } from 'phosphor-react-native/src/icons/Quotes';
import { ShieldCheckIcon } from 'phosphor-react-native/src/icons/ShieldCheck';

import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';
import { ActionSheet, type SheetAction } from '@/components/ui/action-sheet';
import { Avatar } from '@/components/ui/avatar';
import { BackHeader } from '@/components/ui/back-header';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { changePhoto, removePhoto } from '@/lib/avatar-upload';
import { clearCache } from '@/lib/cache';
import { setAppBadge, unregisterPush } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { FINDABLE, labelFor, useAccount, WHO_CAN_MESSAGE } from '@/lib/use-account';
import { useHomeData } from '@/providers/home-provider';
import { brand, createThemedStyles, fonts, radius, space } from '@/theme/tokens';

const ROLE_LABEL = { admin: 'Admin', moderator: 'Moderator' } as const;
const PHOTO = 104;

// Your profile as other students see it, with your settings underneath.
export default function Profile() {
  const styles = useStyles();
  const { account, failed, reload, setAccount } = useAccount();
  const { refresh: refreshHome } = useHomeData();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  async function updatePhoto(run: () => ReturnType<typeof removePhoto>) {
    setPhotoError(null);
    setUploading(true);
    const result = await run().catch(() => ({ status: 'error' as const, message: 'Could not update your photo. Try again.' }));
    setUploading(false);
    if (result.status === 'error') setPhotoError(result.message);
    if (result.status === 'done') {
      setAccount((a) => (a ? { ...a, avatar_path: result.path } : a));
      refreshHome(); // the top bar shows the new photo too
    }
  }

  const photoActions: SheetAction[] = [
    { label: 'Choose from library', onPress: () => updatePhoto(() => changePhoto('library')) },
    { label: 'Take a photo', onPress: () => updatePhoto(() => changePhoto('camera')) },
    ...(account?.avatar_path ? [{ label: 'Remove photo', destructive: true, onPress: () => updatePhoto(removePhoto) }] : []),
  ];

  async function signOut() {
    setSigningOut(true);
    // This phone stops getting the account's notifications first (that needs the session).
    await unregisterPush().catch(() => undefined);
    setAppBadge(0);
    clearCache();
    // Signs out this device only; other devices stay signed in.
    await supabase.auth.signOut({ scope: 'local' });
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
              {/* Red marks the thing to do; what sits on red is Ink. */}
              <View style={styles.cameraBadge}>
                <CameraIcon size={17} weight="bold" color={brand.ink} />
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

        <SettingsGroup title="Privacy" footer="Search and cards show your name, photo, university and batch. Never your email.">
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
            Icon={ProhibitIcon}
            label="Blocked students"
            value={account ? (account.blocked_count === 0 ? 'None' : `${account.blocked_count}`) : undefined}
            onPress={() => router.push('/settings/blocked')}
          />
        </SettingsGroup>

        <SettingsGroup title="Notifications">
          <SettingsRow
            first
            Icon={BellIcon}
            label="Notifications"
            value="New messages, and what the lock screen shows"
            onPress={() => router.push('/settings/notifications')}
          />
        </SettingsGroup>

        <SettingsGroup title="Account">
          <SettingsRow first Icon={GraduationCapIcon} label="University" value={account?.institution.name} />
          <SettingsRow Icon={EnvelopeSimpleIcon} label="Email" value={account ? `${account.email} (only you see this)` : undefined} />
          <SettingsRow Icon={ShieldCheckIcon} label="Verified student" value="Checked and approved by the Uni Era team" />
          <SettingsRow Icon={MoonIcon} label="Appearance" value="Follows your phone's light or dark mode" />
        </SettingsGroup>

        <Button label="Sign out" variant="quiet" onPress={signOut} loading={signingOut} />
      </ScrollView>

      <ActionSheet
        visible={sheetOpen}
        title="Profile photo"
        message="Students see it in search, on your card and in chats."
        actions={photoActions}
        onClose={() => setSheetOpen(false)}
      />
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
    backgroundColor: brand.red,
    borderWidth: 3,
    borderColor: t.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontFamily: fonts.display, fontSize: 26, lineHeight: 32, color: t.text, textAlign: 'center', letterSpacing: -0.2 },
  where: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 21, color: t.textMuted, textAlign: 'center' },
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
  skeletonPhoto: { width: PHOTO, height: PHOTO, borderRadius: PHOTO / 2, backgroundColor: t.surface, marginBottom: space.md },
  skeletonLine: { height: 16, borderRadius: radius.sm, backgroundColor: t.surface, marginTop: space.xs },
}));
