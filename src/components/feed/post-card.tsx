import { router } from 'expo-router';
import { memo, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { BedIcon } from 'phosphor-react-native/src/icons/Bed';
import { CalendarBlankIcon } from 'phosphor-react-native/src/icons/CalendarBlank';
import { ChatCircleIcon } from 'phosphor-react-native/src/icons/ChatCircle';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { ClockIcon } from 'phosphor-react-native/src/icons/Clock';
import { DotsThreeIcon } from 'phosphor-react-native/src/icons/DotsThree';
import { GlobeIcon } from 'phosphor-react-native/src/icons/Globe';
import { HeartIcon } from 'phosphor-react-native/src/icons/Heart';
import { MapPinIcon } from 'phosphor-react-native/src/icons/MapPin';
import { PersonSimpleWalkIcon } from 'phosphor-react-native/src/icons/PersonSimpleWalk';
import { PhoneIcon } from 'phosphor-react-native/src/icons/Phone';
import { ArmchairIcon } from 'phosphor-react-native/src/icons/Armchair';
import { CarIcon } from 'phosphor-react-native/src/icons/Car';
import { CookingPotIcon } from 'phosphor-react-native/src/icons/CookingPot';
import { DeskIcon } from 'phosphor-react-native/src/icons/Desk';
import { ForkKnifeIcon } from 'phosphor-react-native/src/icons/ForkKnife';
import { LightningIcon } from 'phosphor-react-native/src/icons/Lightning';
import { ShowerIcon } from 'phosphor-react-native/src/icons/Shower';
import { SnowflakeIcon } from 'phosphor-react-native/src/icons/Snowflake';
import { TShirtIcon } from 'phosphor-react-native/src/icons/TShirt';
import { WifiHighIcon } from 'phosphor-react-native/src/icons/WifiHigh';
import { ShieldWarningIcon } from 'phosphor-react-native/src/icons/ShieldWarning';

import { ReportSheet, type ReportTarget } from '@/components/chat/report-sheet';
import { lookOf, type Look } from '@/components/feed/post-look';
import { PostPhotos } from '@/components/feed/post-photos';
import { PhotoViewer } from '@/components/shop/shop-image';
import { ActionSheet, type SheetAction } from '@/components/ui/action-sheet';
import { Avatar } from '@/components/ui/avatar';
import { PressableScale } from '@/components/ui/pressable-scale';
import { startDirect } from '@/lib/chat/engine';
import { openChat } from '@/lib/chat/open-chat';
import { dayMonth } from '@/lib/dates';
import {
  ago,
  deletePost,
  doneLabel,
  FACILITY_LABEL,
  GENDER_LABEL,
  hidePost,
  muteAuthor,
  photoUrl,
  ROOM_LABEL,
  rupees,
  setResolved,
  toggleLike,
  undoHide,
  usePost,
  type BodimDetails,
  type JobDetails,
  jobClosed,
  PER_LABEL,
  type Facility,
  type LostFoundDetails,
  type Post,
} from '@/lib/feed';
import { firstName } from '@/lib/use-home';
import { useScheme } from '@/theme/appearance';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

const LINK = /(https?:\/\/[^\s]+)/g;

const FACILITY_ICON: Record<Facility, typeof WifiHighIcon> = {
  wifi: WifiHighIcon,
  meals: ForkKnifeIcon,
  attached_bath: ShowerIcon,
  kitchen: CookingPotIcon,
  ac: SnowflakeIcon,
  furnished: ArmchairIcon,
  bills_included: LightningIcon,
  laundry: TShirtIcon,
  study_area: DeskIcon,
  parking: CarIcon,
};
const LONG = 280;

// One post, as a filled tile with no borders. Each kind has its own colour, so a student can tell
// them apart while scrolling: the whole card takes the kind's tint, with a badge on top naming the
// kind (Question, Lost, Found, Bodim, Job, Notice) and whether it is done, and one main button for what people do with it (answer a question,
// message the person who lost or found something, message or call about a bodim). A bodim leads
// with its rent and facts. Plain posts stay quiet. The menu holds Not interested, Mute and Report,
// or for your own: Edit, Mark as done and Delete. "Not interested" leaves a note with Undo (and
// Mute, the second time for the same person). In the feed, tapping the post opens its comments.
export const PostCard = memo(function PostCard({ id, full = false }: { id: number; full?: boolean }) {
  const theme = useTheme();
  const scheme = useScheme();
  const styles = useStyles();
  const post = usePost(id);
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'remove' | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [photo, setPhoto] = useState<number | null>(null);
  const [offerMute, setOfferMute] = useState(false);
  const [muted, setMuted] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  if (!post || post.deleted) return null;
  const name = firstName(post.author.name);

  if (post.hidden) {
    return (
      <View style={styles.hiddenRow}>
        <Text style={styles.hiddenText}>
          {muted ? `You won't see posts from ${name}.` : "Hidden. You won't see this post again."}
        </Text>
        <View style={styles.hiddenActions}>
          {offerMute && !muted ? (
            <PressableScale
              onPress={() => muteAuthor(post.author.id, true).then((r) => !r.error && setMuted(true))}
              accessibilityRole="button"
              hitSlop={8}>
              <Text style={styles.link}>Mute {name}</Text>
            </PressableScale>
          ) : null}
          <PressableScale
            onPress={() => {
              if (muted) muteAuthor(post.author.id, false);
              setMuted(false);
              undoHide(id);
            }}
            accessibilityRole="button"
            hitSlop={8}>
            <Text style={styles.link}>Undo</Text>
          </PressableScale>
        </View>
      </View>
    );
  }

  const look = lookOf(post, theme, scheme);
  const done = doneLabel(post);
  const bodim = post.tag === 'bodim' ? (post.details as BodimDetails) : null;
  const lostFound = post.tag === 'lost_found' ? (post.details as LostFoundDetails) : null;
  const job = post.tag === 'job' ? (post.details as JobDetails) : null;
  // Past its closing day: shown as closed, no way to apply.
  const closed = job ? jobClosed(job) : false;
  const phone = (bodim ?? job)?.phone;
  const open = (reply = false) =>
    router.push({ pathname: '/post/[id]', params: reply ? { id: String(id), reply: '1' } : { id: String(id) } });
  const long = !full && !expanded && (post.body.length > LONG || post.body.split('\n').length > 6);

  async function message() {
    setOpening(true);
    setNote(null);
    const r = await startDirect({
      user_id: post!.author.id,
      full_name: post!.author.name,
      avatar_path: post!.author.avatar_path,
    });
    setOpening(false);
    if ('error' in r) setNote(r.error ?? 'Could not open the chat. Try again.');
    else openChat(r.conversationId);
  }

  async function remove() {
    const r = await deletePost(id);
    if (r.error) setNote(r.error);
    else if (full) router.back();
  }

  const actions: SheetAction[] = post.mine
    ? [
        ...(post.status !== 'removed'
          ? [{ label: 'Edit post', onPress: () => router.push({ pathname: '/post/new', params: { edit: String(id) } }) }]
          : []),
        ...(done
          ? [
              {
                label: post.resolved ? `Not ${done.done.toLowerCase()} yet` : done.mark,
                onPress: () => setResolved(id, !post.resolved),
              },
            ]
          : []),
        { label: 'Delete post', destructive: true, onPress: () => setConfirm('delete') },
      ]
    : [
        {
          label: 'Not interested',
          onPress: () => hidePost(id).then((r) => setOfferMute((r.data?.author_hidden ?? 0) >= 2)),
        },
        {
          label: `Mute ${name}`,
          onPress: () => {
            hidePost(id);
            muteAuthor(post.author.id, true).then((r) => !r.error && setMuted(true));
          },
        },
        {
          label: 'Report post',
          destructive: true,
          onPress: () => setReporting({ kind: 'post', id: String(id), who: post.author.name, userId: post.author.id }),
        },
        ...(post.can_moderate
          ? [{ label: 'Remove post (moderator)', destructive: true, onPress: () => setConfirm('remove') }]
          : []),
      ];

  // The one thing to do with this post, in its colour.
  const main =
    post.status !== 'live' || !look
      ? null
      : post.mine
        ? done && !post.resolved
          ? { label: done.mark, outline: true, onPress: () => setResolved(id, true) }
          : null
        : post.resolved
          ? null
          : post.tag === 'question'
            ? full
              ? null
              : { label: 'Answer', onPress: () => open(true) }
            : post.tag === 'lost_found'
              ? { label: lostFound?.kind === 'found' ? "It's mine" : 'I found it', onPress: message }
              : post.tag === 'bodim' || (post.tag === 'job' && !closed)
                ? { label: `Message ${name}`, onPress: message }
                : null;

  return (
    <View style={[styles.card, look && { backgroundColor: look.tint }]}>
      <View style={styles.inner}>
        {look ? <Band look={look} post={post} done={done?.done ?? null} closed={closed} /> : null}

        <View style={styles.header}>
          <PressableScale
            onPress={() => router.push({ pathname: '/people/[id]', params: { id: post.author.id } })}
            accessibilityRole="button"
            accessibilityLabel={`${post.author.name}, ${post.author.line ?? ''}`}
            accessibilityHint="Opens their profile"
            style={styles.who}>
            <Avatar name={post.author.name} path={post.author.avatar_path} size={40} />
            <View style={styles.whoText}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {post.author.name}
                </Text>
                <Text style={styles.time}>
                  {ago(post.created_at)}
                  {post.edited ? ', edited' : ''}
                </Text>
              </View>
              {post.author.line ? (
                <Text style={styles.meta} numberOfLines={1}>
                  {post.author.line.replace(' · ', ', ')}
                </Text>
              ) : null}
            </View>
          </PressableScale>
          {post.audience === 'everyone' && !post.other ? (
            <View accessibilityLabel="Shared with every university" accessible>
              <GlobeIcon size={16} color={theme.textMuted} />
            </View>
          ) : null}
          <PressableScale
            onPress={() => setMenu(true)}
            accessibilityRole="button"
            accessibilityLabel="More options"
            hitSlop={10}
            style={styles.more}>
            <DotsThreeIcon size={22} weight="bold" color={theme.textMuted} />
          </PressableScale>
        </View>

        {post.status !== 'live' ? (
          <Text style={styles.status}>
            {post.status === 'hidden'
              ? 'Hidden for now: several students reported it. A moderator will look at it.'
              : 'Removed by a moderator. Only you can see it.'}
          </Text>
        ) : null}

        <PressableScale
          onPress={full ? undefined : () => open()}
          disabled={full}
          accessibilityRole={full ? undefined : 'button'}
          scale={0.995}>
          <View style={styles.content}>
            {bodim ? <BodimFacts details={bodim} look={look!} taken={post.resolved} /> : null}
            {job ? <JobFacts details={job} look={look!} over={post.resolved || closed} /> : null}
            {lostFound?.where ? (
              <View style={styles.factRow}>
                <MapPinIcon size={16} weight="fill" color={look?.solid} />
                <Text style={[styles.factStrong, { color: look?.text }]} numberOfLines={1}>
                  {lostFound.kind === 'found' ? 'Found at ' : 'Lost near '}
                  {lostFound.where}
                </Text>
              </View>
            ) : null}
            {post.body ? (
              <Text
                style={[styles.body, post.tag === 'question' && styles.question]}
                numberOfLines={long ? 6 : undefined}
                selectable={full}>
                {post.body.split(LINK).map((part, i) =>
                  i % 2 === 1 ? (
                    <Text key={i} style={styles.inlineLink} onPress={() => Linking.openURL(part).catch(() => {})}>
                      {part}
                    </Text>
                  ) : (
                    part
                  ),
                )}
              </Text>
            ) : null}
            {long ? (
              <Text style={styles.link} onPress={() => setExpanded(true)} accessibilityRole="button">
                See more
              </Text>
            ) : null}
          </View>
        </PressableScale>

        {post.photos.length > 0 ? (
          <View style={(bodim || job) && (post.resolved || closed) ? styles.dim : null}>
            <PostPhotos photos={post.photos} onOpen={setPhoto} />
          </View>
        ) : null}

        <View style={styles.actions}>
          <PressableScale
            onPress={() => toggleLike(id)}
            disabled={post.status !== 'live'}
            accessibilityRole="button"
            accessibilityState={{ selected: post.liked }}
            accessibilityLabel={`${post.liked ? 'Unlike' : 'Like'}. ${post.like_count} ${post.like_count === 1 ? 'like' : 'likes'}`}
            hitSlop={6}
            style={styles.action}>
            <HeartIcon size={21} weight={post.liked ? 'fill' : 'bold'} color={post.liked ? theme.dangerText : theme.textMuted} />
            {post.like_count > 0 ? (
              <Text style={[styles.count, post.liked && { color: theme.dangerText }]}>{post.like_count}</Text>
            ) : null}
          </PressableScale>
          <PressableScale
            onPress={full ? undefined : () => open()}
            disabled={full}
            accessibilityRole="button"
            accessibilityLabel={`${post.comment_count} ${post.tag === 'question' ? 'answers' : post.comment_count === 1 ? 'comment' : 'comments'}`}
            accessibilityHint={full ? undefined : 'Opens the comments'}
            hitSlop={6}
            style={styles.action}>
            <ChatCircleIcon size={21} weight="bold" color={theme.textMuted} />
            {post.comment_count > 0 ? (
              <Text style={styles.count}>
                {post.tag === 'question'
                  ? `${post.comment_count} ${post.comment_count === 1 ? 'answer' : 'answers'}`
                  : post.comment_count}
              </Text>
            ) : null}
          </PressableScale>
          <View style={styles.flex} />
          {phone && !post.mine && !post.resolved && !closed ? (
            <PressableScale
              onPress={() => Linking.openURL(`tel:${phone}`).catch(() => {})}
              accessibilityRole="button"
              accessibilityLabel={`Call ${name}`}
              hitSlop={4}
              style={[styles.round, { backgroundColor: look ? theme.background : theme.surfaceFocused }]}>
              <PhoneIcon size={18} weight="fill" color={look?.solid} />
            </PressableScale>
          ) : null}
          {main && look ? (
            <PressableScale
              onPress={main.onPress}
              disabled={opening}
              accessibilityRole="button"
              style={[styles.cta, { backgroundColor: main.outline ? theme.background : look.solid }]}>
              <Text style={[styles.ctaText, { color: main.outline ? look.text : look.onSolid }]} numberOfLines={1}>
                {opening ? 'Opening…' : main.label}
              </Text>
            </PressableScale>
          ) : null}
        </View>
        {note ? <Text style={styles.status}>{note}</Text> : null}
      </View>

      <ActionSheet visible={menu} actions={actions} onClose={() => setMenu(false)} />
      <ActionSheet
        visible={!!confirm}
        message={
          confirm === 'remove'
            ? 'Remove this post for breaking the rules? The author is told.'
            : 'Delete this post? Its comments go with it.'
        }
        actions={[{ label: confirm === 'remove' ? 'Remove post' : 'Delete post', destructive: true, onPress: remove }]}
        onClose={() => setConfirm(null)}
      />
      <ReportSheet target={reporting} onClose={() => setReporting(null)} />
      <PhotoViewer
        photo={photo !== null && post.photos[photo] ? { uri: photoUrl(post.photos[photo].id, true) } : null}
        onClose={() => setPhoto(null)}
      />
    </View>
  );
});

/** The top row of a coloured card: the kind, and whether it is done. */
function Band({ look, post, done, closed }: { look: Look; post: Post; done: string | null; closed: boolean }) {
  const styles = useStyles();
  const bodim = post.tag === 'bodim' ? (post.details as BodimDetails) : null;
  return (
    <View style={styles.band}>
      <View style={[styles.badge, { backgroundColor: look.solid }]}>
        <look.Icon size={14} weight="bold" color={look.onSolid} />
        <Text style={[styles.badgeText, { color: look.onSolid }]} numberOfLines={1}>
          {look.label}
        </Text>
      </View>
      {bodim ? (
        <Text style={[styles.bandText, { color: look.text }]} numberOfLines={1}>
          {GENDER_LABEL[bodim.gender]}
        </Text>
      ) : null}
      <View style={styles.flex} />
      {post.resolved && done ? (
        <View style={styles.doneChip}>
          <CheckCircleIcon size={14} weight="fill" color={look.text} />
          <Text style={[styles.bandText, { color: look.text }]}>{done}</Text>
        </View>
      ) : post.tag === 'notice' && post.notice_from ? (
        <Text style={[styles.bandText, { color: look.text }]} numberOfLines={1}>
          from {post.notice_from}
        </Text>
      ) : post.tag === 'question' && post.comment_count === 0 ? (
        <Text style={[styles.bandText, { color: look.text }]}>Be the first to answer</Text>
      ) : post.tag === 'bodim' ? (
        <Text style={[styles.bandText, { color: look.text }]}>Available</Text>
      ) : post.tag === 'job' ? (
        <Text style={[styles.bandText, { color: look.text }]}>{closed ? 'Closed' : 'Hiring'}</Text>
      ) : null}
    </View>
  );
}

/** A job: what it is in large type, the pay, where and when, the closing day, and the one rule that
 * stops most scams. */
function JobFacts({ details, look, over }: { details: JobDetails; look: Look; over: boolean }) {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.bodim}>
      <View style={[styles.bodim, over && styles.dim]}>
        <Text style={[styles.role, over && styles.struck]}>{details.role}</Text>
        <View style={styles.rentRow}>
          {details.pay ? (
            <>
              <Text style={styles.pay}>{rupees(details.pay)}</Text>
              <Text style={styles.perMonth}>{PER_LABEL[details.per ?? 'task']}</Text>
            </>
          ) : (
            <Text style={styles.perMonth}>Pay to discuss</Text>
          )}
        </View>
        <View style={styles.factLine}>
          <View style={styles.factRow}>
            {details.remote ? (
              <GlobeIcon size={16} weight="bold" color={look.solid} />
            ) : (
              <MapPinIcon size={16} weight="fill" color={look.solid} />
            )}
            <Text style={styles.factStrong} numberOfLines={1}>
              {details.remote ? (details.area ? `Remote or ${details.area}` : 'Remote') : details.area}
            </Text>
          </View>
          {details.hours ? (
            <View style={styles.factRow}>
              <ClockIcon size={16} color={theme.textMuted} />
              <Text style={styles.fact}>{details.hours}</Text>
            </View>
          ) : null}
          {details.closes_on ? (
            <View style={styles.factRow}>
              <CalendarBlankIcon size={16} color={theme.textMuted} />
              <Text style={styles.fact}>Apply by {dayMonth(details.closes_on)}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.warn}>
        <ShieldWarningIcon size={15} weight="fill" color={theme.textMuted} />
        <Text style={styles.warnText}>Never pay to get a job. Report anyone who asks you for money.</Text>
      </View>
    </View>
  );
}

/** A bodim's rent in large type, then the place, distance and facilities. */
function BodimFacts({ details, look, taken }: { details: BodimDetails; look: Look; taken: boolean }) {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <View style={[styles.bodim, taken && styles.dim]}>
      <View style={styles.rentRow}>
        <Text style={[styles.rent, taken && styles.struck]}>{rupees(details.rent)}</Text>
        <Text style={styles.perMonth}>a month</Text>
      </View>
      <View style={styles.factRow}>
        <MapPinIcon size={16} weight="fill" color={look.solid} />
        <Text style={styles.factStrong} numberOfLines={1}>
          {details.area}
        </Text>
      </View>
      <View style={styles.factLine}>
        <View style={styles.factRow}>
          <BedIcon size={16} color={theme.textMuted} />
          <Text style={styles.fact}>{ROOM_LABEL[details.room]}</Text>
        </View>
        {details.walk !== undefined ? (
          <View style={styles.factRow}>
            <PersonSimpleWalkIcon size={16} color={theme.textMuted} />
            <Text style={styles.fact}>{details.walk === 0 ? 'Next to campus' : `${details.walk} min walk`}</Text>
          </View>
        ) : null}
        {details.available_from ? (
          <View style={styles.factRow}>
            <CalendarBlankIcon size={16} color={theme.textMuted} />
            <Text style={styles.fact}>From {dayMonth(details.available_from)}</Text>
          </View>
        ) : null}
      </View>
      {details.facilities?.length ? (
        <View style={styles.chips}>
          {details.facilities.map((f) => {
            const Icon = FACILITY_ICON[f];
            return (
              <View key={f} style={styles.chip}>
                <Icon size={13} weight="bold" color={look.text} />
                <Text style={[styles.chipText, { color: look.text }]}>{FACILITY_LABEL[f]}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  flex: { flex: 1 },
  // No border: plain posts sit on the surface grey, the others on their kind's tint.
  card: {
    borderRadius: radius.lg,
    backgroundColor: t.surface,
    overflow: 'hidden',
  },
  inner: { padding: space.md, paddingTop: space.md + 2, gap: space.sm + 2 },
  band: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: 2 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm + 2,
    paddingVertical: 4,
    maxWidth: '70%',
  },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 13 },
  bandText: { fontFamily: fonts.bodyBold, fontSize: 13 },
  doneChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  whoText: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  name: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 15, color: t.text },
  time: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: t.textMuted },
  meta: { fontFamily: fonts.body, fontSize: 13, color: t.textMuted },
  more: { padding: 2 },
  content: { gap: space.sm },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: t.text },
  question: { fontFamily: fonts.bodyBold, fontSize: 17, lineHeight: 24 },
  inlineLink: { color: t.accentText, textDecorationLine: 'underline' },
  link: { fontFamily: fonts.bodyBold, fontSize: 14, color: t.accentText },
  status: { fontFamily: fonts.bodySemiBold, fontSize: 13, lineHeight: 18, color: t.dangerText },
  bodim: { gap: 6 },
  rentRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  rent: { fontFamily: fonts.wordmark, fontSize: 26, lineHeight: 30, color: t.text, letterSpacing: -0.4 },
  perMonth: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: t.textMuted },
  struck: { textDecorationLine: 'line-through' },
  role: { fontFamily: fonts.bodyBold, fontSize: 19, lineHeight: 25, color: t.text },
  pay: { fontFamily: fonts.wordmark, fontSize: 22, lineHeight: 27, color: t.text, letterSpacing: -0.3 },
  warn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  warnText: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 13, lineHeight: 18, color: t.textMuted },
  factLine: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: 4 },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  factStrong: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 14, color: t.text },
  fact: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: t.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm + 2,
    paddingVertical: 4,
    backgroundColor: t.background,
  },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 12 },
  dim: { opacity: 0.55 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    marginTop: 2,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, minWidth: 44 },
  count: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: t.textMuted },
  round: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  cta: { minHeight: 38, borderRadius: radius.pill, paddingHorizontal: space.lg, justifyContent: 'center', maxWidth: 190 },
  ctaText: { fontFamily: fonts.bodyBold, fontSize: 14 },
  hiddenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.lg,
    backgroundColor: t.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  hiddenText: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: t.textMuted },
  hiddenActions: { flexDirection: 'row', gap: space.lg },
}));
