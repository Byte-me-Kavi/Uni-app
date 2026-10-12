import { router } from 'expo-router';
import { memo } from 'react';
import { Text, View } from 'react-native';

import { ShopImage } from '@/components/shop/shop-image';
import { PressableScale } from '@/components/ui/pressable-scale';
import { cardLine, price, type ListingCard as Card } from '@/lib/shop';
import { createThemedStyles, fonts, radius, space } from '@/theme/tokens';

// One listing in the shop grid: a bordered card with the photo inset, the price on a swing tag
// (the label hung on new clothes, with its punched hole) over the photo, then the name and one line
// (when pre-orders close, or condition and category). A tag at the top says what it is to you:
// your order, merch, the university it comes from, or your own listing.
export const ListingCard = memo(function ListingCard({ listing }: { listing: Card }) {
  const styles = useStyles();
  const tag = listing.my_order
    ? 'You ordered'
    : listing.other
      ? (listing.institution ?? 'Other uni')
      : listing.kind === 'merch'
        ? (listing.club ?? 'Merch')
        : listing.mine
          ? 'Yours'
          : null;
  const line = cardLine(listing);
  const ended = listing.kind === 'merch' ? !listing.ordering : listing.status === 'sold';
  return (
    <PressableScale
      onPress={() => router.push({ pathname: '/shop/[id]', params: { id: listing.id } })}
      accessibilityRole="button"
      accessibilityLabel={[listing.title, price(listing.price), tag, line].filter(Boolean).join(', ')}
      accessibilityHint="Opens the listing"
      scale={0.98}
      style={styles.card}>
      <View>
        <ShopImage path={listing.photo} style={[styles.photo, ended && styles.photoEnded]} />
        {tag ? (
          <View style={[styles.badge, listing.my_order && styles.badgeOrdered]}>
            <Text style={[styles.badgeText, listing.my_order && styles.badgeTextOrdered]} numberOfLines={1}>
              {tag}
            </Text>
          </View>
        ) : null}
        <View style={styles.swing} importantForAccessibility="no-hide-descendants">
          <View style={styles.hole} />
          <Text style={styles.price} numberOfLines={1}>
            {price(listing.price)}
          </Text>
        </View>
      </View>
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={2}>
          {listing.title}
        </Text>
        <Text style={[styles.line, ended && styles.lineEnded]} numberOfLines={1}>
          {line}
        </Text>
      </View>
    </PressableScale>
  );
});

const useStyles = createThemedStyles((t) => ({
  card: {
    flex: 1,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.lg,
    backgroundColor: t.background,
    padding: 6,
    gap: space.sm,
  },
  // Inset in the card, so its corners follow the card's.
  photo: { width: '100%', aspectRatio: 1, borderRadius: radius.lg - 6 },
  photoEnded: { opacity: 0.55 },
  badge: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    maxWidth: '80%',
    backgroundColor: t.elevated,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm + 2,
    paddingVertical: 3,
  },
  // Your own order: the accent (it means you).
  badgeOrdered: { backgroundColor: t.accent },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.text },
  badgeTextOrdered: { color: t.onAccent },
  // The swing tag: square on the photo's edge, rounded on the price end, with a punched hole.
  swing: {
    position: 'absolute',
    left: 0,
    bottom: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '92%',
    backgroundColor: t.elevated,
    borderTopRightRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
    paddingLeft: space.sm,
    paddingRight: space.sm + 2,
    paddingVertical: 5,
  },
  hole: { width: 7, height: 7, borderRadius: 4, borderWidth: 1.5, borderColor: t.borderFilled },
  price: { fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  copy: { gap: 2, paddingHorizontal: 4, paddingBottom: 6 },
  title: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 20, color: t.text },
  line: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: t.accentText },
  lineEnded: { color: t.textMuted },
}));
