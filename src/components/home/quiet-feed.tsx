import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { lookOf } from '@/components/feed/post-look';
import { PressableScale } from '@/components/ui/pressable-scale';
import type { PostTag } from '@/lib/feed';
import { useScheme } from '@/theme/appearance';
import { createThemedStyles, fonts, radius, space, useTheme } from '@/theme/tokens';

type Copy = { title: string; body: string; action?: string };

// What each filter says when it is empty, and the post it invites. Notices come from reps, clubs and the Uni Era team, so no action.
const COPY: Record<PostTag, Copy> = {
  question: {
    title: 'No questions yet',
    body: 'Stuck on a form, a lecture hall or where to eat? Ask, and students at your university answer.',
    action: 'Ask a question',
  },
  lost_found: {
    title: 'Nothing lost or found lately',
    body: 'Lost something on campus, or picked something up? Post it so the owner can find it.',
    action: 'Post lost or found',
  },
  bodim: {
    title: 'No bodims listed',
    body: 'Have a room near campus to rent out? List it for students at your university.',
    action: 'List a bodim',
  },
  job: {
    title: 'No part time jobs yet',
    body: 'Hiring students for a few hours a week? Post the job here.',
    action: 'Post a job',
  },
  notice: {
    title: 'No notices',
    body: 'Notices from batch reps, clubs and the Uni Era team show up here.',
  },
};

const ALL: Copy = {
  title: 'Quiet for now',
  body: 'Nobody at your university has posted yet. Start with a question or something happening on campus.',
  action: 'Write a post',
};

const WAITING: Copy = {
  title: 'Opens once you are approved',
  body: 'Posts, questions and lost and found from students at your university show up here once the Uni Era team approves your account.',
};

// Empty state for the feed: a block in the filter's own colour that says what belongs here and opens
// the composer for it. After a search that found nothing, it says so and offers to clear it. No
// invented content.
export function QuietFeed({
  waiting = false,
  heading = true,
  tag = null,
  canPost = false,
  onShowAll,
  query = '',
  onClearSearch,
}: {
  waiting?: boolean;
  heading?: boolean;
  tag?: PostTag | null;
  canPost?: boolean;
  onShowAll?: () => void;
  /** The words searched for, when a search found nothing. */
  query?: string;
  onClearSearch?: () => void;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const styles = useStyles();
  const look = tag && !waiting ? lookOf({ tag, details: null, notice_from: null }, theme, scheme) : null;
  const copy: Copy = query
    ? {
        title: `Nothing matches “${query}”`,
        body: tag
          ? 'Try other words, or search every kind of post.'
          : 'Try other words, or fewer of them. Search looks through posts from the last year.',
      }
    : waiting
      ? WAITING
      : tag
        ? COPY[tag]
        : ALL;
  const action = canPost && !waiting && !query ? copy.action : undefined;
  const ink = look?.text ?? theme.text;

  return (
    <View style={styles.section}>
      {heading ? (
        <Text style={styles.heading} accessibilityRole="header">
          Your feed
        </Text>
      ) : null}
      <View style={[styles.block, { backgroundColor: look?.tint ?? theme.surface }]}>
        <Text style={[styles.title, { color: ink }]}>{copy.title}</Text>
        <Text style={[styles.body, look ? { color: ink } : null]}>{copy.body}</Text>
        {action || (tag && onShowAll) || (query && onClearSearch) ? (
          <View style={styles.actions}>
            {action ? (
              <PressableScale
                onPress={() =>
                  router.push(tag && tag !== 'notice' ? { pathname: '/post/new', params: { type: tag } } : '/post/new')
                }
                accessibilityRole="button"
                style={[styles.action, { backgroundColor: look?.solid ?? theme.accent }]}>
                <Text style={[styles.actionText, { color: look?.onSolid ?? theme.onAccent }]}>{action}</Text>
              </PressableScale>
            ) : null}
            {tag && onShowAll ? (
              <PressableScale onPress={onShowAll} accessibilityRole="button" hitSlop={6} style={styles.showAll}>
                <Text style={[styles.showAllText, { color: ink }]}>{query ? 'Search all posts' : 'See all posts'}</Text>
              </PressableScale>
            ) : null}
            {query && onClearSearch ? (
              <PressableScale onPress={onClearSearch} accessibilityRole="button" hitSlop={6} style={styles.showAll}>
                <Text style={[styles.showAllText, { color: ink }]}>Clear search</Text>
              </PressableScale>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  section: { gap: space.md },
  heading: { fontFamily: fonts.display, fontSize: 21, color: t.text },
  block: {
    borderRadius: radius.lg,
    paddingHorizontal: space.xl,
    paddingTop: space.xl + space.sm,
    paddingBottom: space.xl,
    gap: space.sm,
  },
  title: { fontFamily: fonts.display, fontSize: 26, lineHeight: 31, letterSpacing: -0.2 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: t.textMuted, maxWidth: 420 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.lg, marginTop: space.md },
  action: {
    minHeight: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { fontFamily: fonts.bodyBold, fontSize: 15 },
  showAll: { minHeight: 44, justifyContent: 'center' },
  showAllText: { fontFamily: fonts.bodyBold, fontSize: 15, textDecorationLine: 'underline' },
}));
