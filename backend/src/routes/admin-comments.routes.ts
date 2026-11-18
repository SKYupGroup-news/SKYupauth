import { Router } from 'express';
import { prisma, estimatedCount } from '@/lib/db';
import { ApiError, asyncHandler } from '@/lib/http';
import { requireAdmin } from '@/lib/current-user';
import { AUTHOR_SELECT, toPublicAuthor } from '@/lib/engagement';
import { premiumSubscriptionWhere } from '@/lib/subscription';
import type { Prisma } from '@/generated/prisma';

export const adminCommentsRouter = Router();

const PAGE_SIZE = 25;
const NO_LOCATION = '__none__';

const MODERATION_AUTHOR_SELECT = {
  ...AUTHOR_SELECT,
  country: true,
  state: true,
  city: true,
  status: true,
} as const;

export const ACCOUNT_FILTERS = ['all', 'paid', 'free', 'suspended'] as const;
export type AccountFilter = (typeof ACCOUNT_FILTERS)[number];

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

// GET /api/admin/comments
adminCommentsRouter.get(
  '/comments',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const articleId = typeof req.query.articleId === 'string' ? req.query.articleId.trim() : '';
    const filterParam = typeof req.query.filter === 'string' ? req.query.filter : 'all';
    const filter: CommentFilter = ['all', 'visible', 'removed', 'replies'].includes(filterParam)
      ? (filterParam as CommentFilter)
      : 'all';
    const page = Math.max(1, Number(req.query.page) || 1);

    const country = typeof req.query.country === 'string' ? req.query.country.trim() : '';
    const state = typeof req.query.state === 'string' ? req.query.state.trim() : '';
    const city = typeof req.query.city === 'string' ? req.query.city.trim() : '';
    const newsLocation = typeof req.query.newsLocation === 'string' ? req.query.newsLocation.trim() : '';

    const accountParam = typeof req.query.account === 'string' ? req.query.account : 'all';
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

    const authorIds = query
      ? (
          await prisma.user.findMany({
            where: {
              OR: [
                { displayName: { contains: query, mode: 'insensitive' } },
                { email: { contains: query, mode: 'insensitive' } },
              ],
            },
            select: { id: true },
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

    const facetWhere: Prisma.CommentWhereInput = {
      AND: [search, filterToWhere(filter), accountToWhere(account, now), newsLocationWhere],
    };

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
      prisma.comment.count({ where }),
      prisma.comment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          user: { select: MODERATION_AUTHOR_SELECT },
          _count: { select: { likes: true, replies: true } },
          parent: {
            select: { id: true, body: true, deletedAt: true, user: { select: AUTHOR_SELECT } },
          },
        },
      }),
      estimatedCount('comments'),
      prisma.comment.count({ where: { deletedAt: { not: null } } }),
      prisma.comment.count({ where: { parentId: { not: null }, deletedAt: null } }),
      estimatedCount('comment_likes'),
      prisma.comment.findMany({
        where: facetWhere,
        select: { user: { select: { country: true, state: true, city: true } } },
        distinct: ['userId'],
        take: 5000,
      }),
      prisma.comment.groupBy({
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

    res.json({
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
              body: row.parent.deletedAt ? null : row.parent.body,
            }
          : null,
        likeCount: row._count.likes,
        replyCount: row._count.replies,
        createdAt: row.createdAt,
      })),
    });
  })
);

// DELETE /api/admin/comments/:commentId (Permanent Delete)
adminCommentsRouter.delete(
  '/comments/:commentId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { commentId } = req.params;
    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) {
      throw new ApiError('not_found', 'No such comment.');
    }

    const counterUpdates = [];
    if (!comment.deletedAt) {
      counterUpdates.push(
        prisma.articleStat.updateMany({
          where: { articleId: comment.articleId },
          data: { commentCount: { decrement: 1 } },
        })
      );
      if (comment.parentId) {
        counterUpdates.push(
          prisma.comment.update({
            where: { id: comment.parentId },
            data: { replyCount: { decrement: 1 } },
          })
        );
      }
    }

    await prisma.$transaction([
      ...counterUpdates,
      prisma.comment.delete({ where: { id: commentId } }),
    ]);

    res.json({ ok: true, commentId, permanentlyDeleted: true });
  })
);

// POST /api/admin/comments/:commentId/restore
adminCommentsRouter.post(
  '/comments/:commentId/restore',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { commentId } = req.params;
    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) throw new ApiError('not_found', 'No such comment.');
    if (!comment.deletedAt) throw new ApiError('conflict', 'That comment is not removed.');

    await prisma.$transaction([
      prisma.comment.update({
        where: { id: commentId },
        data: { deletedAt: null },
      }),
      prisma.articleStat.updateMany({
        where: { articleId: comment.articleId },
        data: { commentCount: { increment: 1 } },
      }),
      ...(comment.parentId
        ? [
            prisma.comment.update({
              where: { id: comment.parentId },
              data: { replyCount: { increment: 1 } },
            }),
          ]
        : []),
    ]);

    res.json({ ok: true, commentId, deleted: false });
  })
);
