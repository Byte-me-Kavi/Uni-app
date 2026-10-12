import { useState } from 'react';
import { Text, View } from 'react-native';
import { DownloadSimpleIcon } from 'phosphor-react-native/src/icons/DownloadSimple';

import { ActionSheet } from '@/components/ui/action-sheet';
import { PressableScale } from '@/components/ui/pressable-scale';
import { formatBytes } from '@/lib/chat/attachments';
import { downloadModule, onWifi, readPack, removeModule, type OfflinePack } from '@/lib/offline';
import { useSession } from '@/providers/session-provider';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

// "Download for offline": every file of the module on the phone, to study with no data (on the bus,
// in the exam hall queue). On Wi-Fi only, unless the student says so.
export function OfflineCard({ moduleId, code }: { moduleId: number; code: string }) {
  const theme = useTheme();
  const styles = useStyles();
  const session = useSession();
  const userId = session.status === 'signed_in' ? session.session.user.id : null;
  const [pack, setPack] = useState<OfflinePack | null>(() => (userId ? readPack(userId, moduleId) : null));
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'data' | 'unknown' | 'remove' | null>(null);

  async function download() {
    if (!userId) return;
    setNote(null);
    setProgress({ done: 0, total: 0 });
    const { pack: next, failed } = await downloadModule(userId, moduleId, (done, total) => setProgress({ done, total }));
    setProgress(null);
    setPack(next);
    setNote(failed ? `${failed} could not be downloaded. Try again on Wi-Fi.` : null);
  }

  async function start() {
    const wifi = await onWifi();
    if (wifi) download();
    else setConfirm(wifi === false ? 'data' : 'unknown');
  }

  const size = pack?.files.reduce((sum, f) => sum + f.size, 0) ?? 0;
  const label = progress
    ? progress.total
      ? `Downloading ${progress.done} of ${progress.total}…`
      : 'Getting the list…'
    : pack
      ? `${pack.files.length === 1 ? '1 file' : `${pack.files.length} files`} · ${formatBytes(size)} on this phone`
      : `Keep every ${code} file on this phone`;

  return (
    <View style={styles.card}>
      <DownloadSimpleIcon size={22} weight="bold" color={theme.text} />
      <View style={styles.copy}>
        <Text style={styles.title}>{pack ? 'Available offline' : 'Study offline'}</Text>
        <Text style={styles.meta}>{label}</Text>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
      {!progress ? (
        <View style={styles.actions}>
          <PressableScale onPress={start} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.link}>{pack ? 'Update' : 'Download'}</Text>
          </PressableScale>
          {pack ? (
            <PressableScale onPress={() => setConfirm('remove')} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.remove}>Remove</Text>
            </PressableScale>
          ) : null}
        </View>
      ) : null}
      <ActionSheet
        visible={confirm !== null}
        title={confirm === 'remove' ? `Remove ${code} from this phone?` : confirm === 'data' ? 'You are on mobile data' : 'Are you on Wi-Fi?'}
        message={
          confirm === 'remove'
            ? 'The files stay in your library and download again when you open them.'
            : confirm === 'data'
              ? 'Downloading a whole module can use a lot of data. Wait for Wi-Fi, or download now.'
              : 'Downloading a whole module can use a lot of data.'
        }
        actions={
          confirm === 'remove'
            ? [
                {
                  label: 'Remove offline copies',
                  destructive: true,
                  onPress: async () => {
                    if (!userId) return;
                    await removeModule(userId, moduleId);
                    setPack(null);
                  },
                },
              ]
            : [{ label: 'Download now', onPress: download }]
        }
        onClose={() => setConfirm(null)}
      />
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg },
  copy: { flex: 1, gap: 1 },
  title: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  meta: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  note: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: t.dangerText },
  actions: { alignItems: 'flex-end', gap: space.sm },
  link: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.accentText },
  remove: { fontFamily: fonts.bodyBold, fontSize: 13, color: t.dangerText },
}));
