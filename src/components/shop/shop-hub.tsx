import { router } from 'expo-router';
import { memo, type ComponentType } from 'react';
import { Text, View } from 'react-native';
import type { IconProps } from 'phosphor-react-native';
import { BagIcon } from 'phosphor-react-native/src/icons/Bag';
import { TagIcon } from 'phosphor-react-native/src/icons/Tag';

import { PressableScale } from '@/components/ui/pressable-scale';
import type { ListingCard, OrderWithListing } from '@/lib/shop';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

export type HubSummary = { orders: OrderWithListing[]; listings: ListingCard[] };

// The way into the student's own side of the shop, at the top of the Shop tab: what they ordered
// and what they sell. When slips are waiting for a rep, a banner above says how many and opens the
// orders straight away, so a rep never has to hunt for them.
export const ShopHub = memo(function ShopHub({ summary }: { summary: HubSummary | null }) {
  const styles = useStyles();
  const orders = summary?.orders ?? [];
  const listings = (summary?.listings ?? []).filter((l) => l.status !== 'removed');
  const active = orders.filter((o) => o.status !== 'collected').length;
  const needsFix = orders.filter((o) => o.status === 'rejected').length;
  const waiting = listings.filter((l) => (l.to_check ?? 0) > 0);
  const toCheck = waiting.reduce((n, l) => n + (l.to_check ?? 0), 0);
  const orderCount = listings.reduce((n, l) => n + (l.orders ?? 0), 0);

  return (
    <View style={styles.wrap}>
      {toCheck > 0 ? (
        <PressableScale
          onPress={() =>
            waiting.length === 1
              ? router.push({ pathname: '/shop/orders/[id]', params: { id: waiting[0].id } })
              : router.push({ pathname: '/shop/mine', params: { tab: 'listings' } })
          }
          accessibilityRole="button"
          accessibilityLabel={`${toCheck} payment ${toCheck === 1 ? 'slip' : 'slips'} to check. Open orders`}
          scale={0.985}
          style={styles.alert}>
          <View style={styles.alertCount}>
            <Text style={styles.alertCountText}>{toCheck > 99 ? '99+' : toCheck}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.alertTitle}>{toCheck === 1 ? 'Slip to check' : 'Slips to check'}</Text>
            <Text style={styles.alertBody} numberOfLines={1}>
              {waiting.length === 1 ? waiting[0].title : `In ${waiting.length} listings`}
            </Text>
          </View>
          <View style={styles.alertButton}>
            <Text style={styles.alertButtonText}>Open orders</Text>
          </View>
        </PressableScale>
      ) : null}

      <View style={styles.tiles}>
        <Tile
          Icon={BagIcon}
          title="Your orders"
          line={
            needsFix > 0
              ? `${needsFix} ${needsFix === 1 ? 'needs' : 'need'} a fix`
              : active > 0
                ? `${active} in progress`
                : 'Merch you pre-order'
          }
          alert={needsFix > 0}
          onPress={() => router.push({ pathname: '/shop/mine', params: { tab: 'orders' } })}
        />
        <Tile
          Icon={TagIcon}
          title="Selling"
          line={
            listings.length === 0
              ? 'Nothing listed yet'
              : orderCount > 0
                ? `${orderCount} ${orderCount === 1 ? 'order' : 'orders'} received`
                : `${listings.length} ${listings.length === 1 ? 'listing' : 'listings'}`
          }
          onPress={() => router.push({ pathname: '/shop/mine', params: { tab: 'listings' } })}
        />
      </View>
    </View>
  );
});

function Tile({
  Icon,
  title,
  line,
  alert = false,
  onPress,
}: {
  Icon: ComponentType<IconProps>;
  title: string;
  line: string;
  alert?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${line}`}
      scale={0.98}
      style={styles.tile}>
      <View style={styles.tileIcon}>
        <Icon size={20} weight="bold" color={theme.onAccentTint} />
      </View>
      <Text style={styles.tileTitle}>{title}</Text>
      <Text style={[styles.tileLine, alert && styles.tileAlert]} numberOfLines={1}>
        {line}
      </Text>
    </PressableScale>
  );
}

const useStyles = createThemedStyles((t) => ({
  wrap: { gap: space.md },
  flex: { flex: 1 },
  tiles: { flexDirection: 'row', gap: space.md },
  tile: {
    flex: 1,
    minHeight: 104,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.lg,
    backgroundColor: t.background,
    padding: space.md,
    gap: 2,
  },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: t.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  tileTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.text },
  tileLine: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  tileAlert: { fontFamily: fonts.bodyBold, color: t.dangerText },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: t.accentTint,
    borderRadius: radius.lg,
    padding: space.md,
  },
  alertCount: {
    minWidth: 40,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: space.sm,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertCountText: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.onAccent },
  alertTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.onAccentTint },
  alertBody: { fontFamily: fonts.body, fontSize: 14, color: t.onAccentTint },
  alertButton: {
    backgroundColor: t.accent,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    minHeight: 36,
    justifyContent: 'center',
  },
  alertButtonText: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.onAccent },
}));
