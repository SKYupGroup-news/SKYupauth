import { NextResponse } from 'next/server';
import { estimatedCount, replica } from '@/lib/db';
import { requireUser } from '@/lib/current-user';
import { ApiError, handleRoute } from '@/lib/http';
import { AUTHOR_SELECT, toPublicAuthor } from '@/lib/engagement';
import { premiumSubscriptionWhere } from '@/lib/subscription';
import type { Prisma } from '@/generated/prisma';

const PAGE_SIZE = 25;

/** Sentinel for authors with no location on their profile. */
export const NO_LOCATION = '__none__';

/**
 * Author fields for the ADMIN view only.
 *
 * Deliberately separate from AUTHOR_SELECT, which feeds public comment threads:
 * location and account status must never travel with a public comment, and
 * widening the shared select would leak them everywhere at once.
 */
const MODERATION_AUTHOR_SELECT = {
  ...AUTHOR_SELECT,
  country: true,
  state: true,
  city: true,
  status: true,
} as const;

export const ACCOUNT_FILTERS = ['all', 'paid', 'free', 'suspended'] as const;
export type AccountFilter = (typeof ACCOUNT_FILTERS)[number];

/**
 * Narrows comments by the state of the account that wrote them.
 *
 * A relation filter in an AND position, unlike the OR used for search: this
 * form still resolves through the author index, so it does not reintroduce the
 * cross-table scan that the search path was rewritten to avoid.
 */
function accountToWhere(account: AccountFilter, now: Date): Prisma.CommentWhereInput {
  switch (account) {
    case 'paid':
      return { user: { subscription: { is: premiumSubscriptionWhere(now) } } };
    case 'free':
      return { user: { NOT: { subscription: { is: premiumSubscriptionWhere(now) } } } };
    case 'suspended':
      return { user: { status: 'SUSPENDED' } };
    default:
      return {};
  }
}

export type CommentFilter = 'all' | 'visible' | 'removed' | 'replies';

function filterToWhere(filter: CommentFilter): Prisma.CommentWhereInput {
  switch (filter) {
    case 'visible':
      return { deletedAt: null };
    case 'removed':
      return { deletedAt: { not: null } };
    case 'replies':
      return { parentId: { not: null }, deletedAt: null };
    default:
      return {};
  }
}

/** Every comment and reply on the platform, for moderation. */
export const GET = handleRoute(async (request: Request) => {
  const actor = await requireUser(request);
  if (actor.role !== 'ADMIN') {
    throw new ApiError('forbidden', 'Only administrators can moderate comments.');
  }

  const url = new URL(request.url);
  const query = url.searchParams.get('q')?.trim() ?? '';
  const articleId = url.searchParams.get('articleId')?.trim() ?? '';
  const filterParam = (url.searchParams.get('filter') ?? 'all') as CommentFilter;
  const filter: CommentFilter = ['all', 'visible', 'removed', 'replies'].includes(filterParam)
    ? filterParam
    : 'all';
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);

  // Location comes from the author's own profile, same as the audience view.
  const country = url.searchParams.get('country')?.trim() || '';
  const state = url.searchParams.get('state')?.trim() || '';
  const city = url.searchParams.get('city')?.trim() || '';

  // Where the STORY is from, as opposed to where its author lives.
  const newsLocation = url.searchParams.get('newsLocation')?.trim() || '';

  const accountParam = url.searchParams.get('account') ?? 'all';
  const account: AccountFilter = (ACCOUNT_FILTERS as readonly string[]).includes(accountParam)
    ? (accountParam as AccountFilter)
    : 'all';

  const now = new Date();

  const locationWhere: Prisma.CommentWhereInput =
    country || state || city
      ? {
          user: {
            ...(country ? (country === NO_LOCATION ? { country: null } : { country }) : {}),
            ...(state ? (state === NO_LOCATION ? { state: null } : { state }) : {}),
            ...(city ? (city === NO_LOCATION ? { city: null } : { city }) : {}),
          },
        }
      : {};

  // Search covers what a moderator has to hand: the text, the story, or who
  // wrote it. Author matching is resolved to ids FIRST and fed back as a plain
  // `userId IN (...)`: an OR that reaches across the join to `users` cannot use
  // any index and degrades into a sequential scan of both tables.
  const authorIds = query
    ? (
        await replica.user.findMany({
          where: {
            OR: [
              { displayName: { contains: query, mode: 'insensitive' } },
              { email: { contains: query, mode: 'insensitive' } },
            ],
          },
          select: { id: true },
          // Bounded: a one-letter search must not pull back every reader.
          take: 500,
        })
      ).map((row) => row.id)
    : [];

  const search: Prisma.CommentWhereInput = query
    ? {
        OR: [
          { body: { contains: query, mode: 'insensitive' } },
          { articleTitle: { contains: query, mode: 'insensitive' } },
          ...(authorIds.length ? [{ userId: { in: authorIds } }] : []),
        ],
      }
    : {};

  const newsLocationWhere: Prisma.CommentWhereInput = newsLocation
    ? newsLocation === NO_LOCATION
      ? { articleLocation: null }
      : { articleLocation: newsLocation }
    : {};

  const where: Prisma.CommentWhereInput = {
    AND: [
      newsLocationWhere,
      search,
      filterToWhere(filter),
      articleId ? { articleId } : {},
      locationWhere,
      accountToWhere(account, now),
    ],
  };

  // Facets ignore location so changing region never empties the dropdowns, but
  // respect the other filters so the counts describe what is on screen.
  const facetWhere: Prisma.CommentWhereInput = {
    AND: [search, filterToWhere(filter), accountToWhere(account, now), newsLocationWhere],
  };

  // The dateline facet excludes the dateline filter itself, for the same reason.
  const newsFacetWhere: Prisma.CommentWhereInput = {
    AND: [search, filterToWhere(filter), accountToWhere(account, now), locationWhere],
  };

  const [
      total,
      rows,
      totalComments,
      removedCount,
      replyCount,
      likeTotal,
      locationRows,
      newsLocationRows,
    ] = await Promise.all([
      replica.comment.count({ where }),
      replica.comment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          user: { select: MODERATION_AUTHOR_SELECT },
          _count: { select: { likes: true, replies: true } },
          // Enough of the parent to show what a reply is answering.
          parent: {
            select: { id: true, body: true, deletedAt: true, user: { select: AUTHOR_SELECT } },
          },
        },
      }),
      // Dashboard totals use planner estimates: exact counts scan the table and
      // the cost grows with every comment ever written.
      estimatedCount('comments'),
      replica.comment.count({ where: { deletedAt: { not: null } } }),
      replica.comment.count({ where: { parentId: { not: null }, deletedAt: null } }),
      estimatedCount('comment_likes'),
      // Distinct author locations among the comments in scope, so the dropdowns
      // only ever offer places that would actually return rows.
      replica.comment.findMany({
        where: facetWhere,
        select: { user: { select: { country: true, state: true, city: true } } },
        distinct: ['userId'],
        take: 5000,
      }),
      // Story datelines present in the current scope, with how many comments each has.
      replica.comment.groupBy({
        by: ['articleLocation'],
        where: newsFacetWhere,
        _count: { _all: true },
      }),
    ]);

  const newsLocations = newsLocationRows
    .map((row) => ({
      value: row.articleLocation ?? NO_LOCATION,
      label: row.articleLocation ?? 'No dateline',
      count: row._count._all,
    }))
    // Real places first and biggest first; "No dateline" always last.
    .sort((a, b) =>
      a.value === NO_LOCATION ? 1 : b.value === NO_LOCATION ? -1 : b.count - a.count,
    );

  const regionMap = new Map<
    string,
    {
      value: string;
      label: string;
      count: number;
      states: Map<string, { value: string; label: string; count: number; cities: Map<string, number> }>;
      cities: Map<string, number>;
    }
  >();

  for (const row of locationRows) {
    const value = row.user.country ?? NO_LOCATION;
    const label = row.user.country ?? 'No location set';
    const entry =
      regionMap.get(value) ?? {
        value,
        label,
        count: 0,
        states: new Map(),
        cities: new Map(),
      };

    entry.count += 1;

    const stateValue = row.user.state ?? NO_LOCATION;
    const stateLabel = row.user.state ?? 'No state set';
    const stateEntry = entry.states.get(stateValue) ?? {
      value: stateValue,
      label: stateLabel,
      count: 0,
      cities: new Map(),
    };
    stateEntry.count += 1;

    const cityValue = row.user.city ?? NO_LOCATION;
    stateEntry.cities.set(cityValue, (stateEntry.cities.get(cityValue) ?? 0) + 1);
    entry.states.set(stateValue, stateEntry);

    entry.cities.set(cityValue, (entry.cities.get(cityValue) ?? 0) + 1);
    regionMap.set(value, entry);
  }

  const regions = [...regionMap.values()]
    .sort((a, b) =>
      a.value === NO_LOCATION ? 1 : b.value === NO_LOCATION ? -1 : b.count - a.count,
    )
    .map((entry) => ({
      value: entry.value,
      label: entry.label,
      count: entry.count,
      states: [...entry.states.values()]
        .map((s) => ({
          value: s.value,
          label: s.label,
          count: s.count,
          cities: [...s.cities.entries()]
            .map(([cVal, cCount]) => ({
              value: cVal,
              label: cVal === NO_LOCATION ? 'No city set' : cVal,
              count: cCount,
            }))
            .sort((a, b) =>
              a.value === NO_LOCATION ? 1 : b.value === NO_LOCATION ? -1 : b.count - a.count,
            ),
        }))
        .sort((a, b) =>
          a.value === NO_LOCATION ? 1 : b.value === NO_LOCATION ? -1 : b.count - a.count,
        ),
      cities: [...entry.cities.entries()]
        .map(([value, count]) => ({
          value,
          label: value === NO_LOCATION ? 'No city set' : value,
          count,
        }))
        .sort((a, b) =>
          a.value === NO_LOCATION ? 1 : b.value === NO_LOCATION ? -1 : b.count - a.count,
        ),
    }));

  return NextResponse.json({
    summary: {
      total: totalComments,
      visible: totalComments - removedCount,
      removed: removedCount,
      replies: replyCount,
      likes: likeTotal,
    },
    regions,
    newsLocations,
    activeLocation: { country, state, city, newsLocation },
    account,
    page,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    pageSize: PAGE_SIZE,
    comments: rows.map((row) => ({
      id: row.id,
      body: row.body,
      deleted: row.deletedAt !== null,
      deletedAt: row.deletedAt,
      author: toPublicAuthor(row.user),
      authorId: row.userId,
      authorCountry: row.user.country,
      authorState: row.user.state,
      authorCity: row.user.city,
      authorStatus: row.user.status,
      articleId: row.articleId,
      articleTitle: row.articleTitle,
      articleLocation: row.articleLocation,
      isReply: row.parentId !== null,
      parent: row.parent
        ? {
            id: row.parent.id,
            author: toPublicAuthor(row.parent.user),
            // Withdrawn parents keep their place but not their text.
            body: row.parent.deletedAt ? null : row.parent.body,
          }
        : null,
      likeCount: row._count.likes,
      replyCount: row._count.replies,
      createdAt: row.createdAt,
    })),
  });
});
