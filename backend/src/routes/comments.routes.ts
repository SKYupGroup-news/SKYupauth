import { Router } from 'express';
import { prisma } from '@/lib/db';
import { ApiError, asyncHandler } from '@/lib/http';
import { requireAuth, getUserFromRequest } from '@/lib/current-user';
import { AUTHOR_SELECT, toPublicAuthor, getArticleThread, notify } from '@/lib/engagement';

export const commentsRouter = Router();

// POST /api/comments/:commentId/like (toggle)
commentsRouter.post(
  '/comments/:commentId/like',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const { commentId } = req.params;

    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.deletedAt) {
      throw new ApiError('not_found', 'That comment no longer exists.');
    }

    const existing = await prisma.commentLike.findUnique({
      where: { userId_commentId: { userId: user.id, commentId } },
    });

    let likedByMe: boolean;
    let likeCount: number;

    if (existing) {
      // Unlike. Counter changes in the same transaction as the row.
      const [, updated] = await prisma.$transaction([
        prisma.commentLike.delete({ where: { id: existing.id } }),
        prisma.comment.update({
          where: { id: commentId },
          data: { likeCount: { decrement: 1 } },
          select: { likeCount: true },
        }),
      ]);
      likedByMe = false;
      likeCount = Math.max(0, updated.likeCount);
    } else {
      try {
        const [, updated] = await prisma.$transaction([
          prisma.commentLike.create({ data: { userId: user.id, commentId } }),
          prisma.comment.update({
            where: { id: commentId },
            data: { likeCount: { increment: 1 } },
            select: { likeCount: true },
          }),
        ]);
        likedByMe = true;
        likeCount = updated.likeCount;
      } catch (err: any) {
        // Double-tap: the unique index rejected the second insert, so the
        // reader has already liked it. Report the current state, don't fail.
        if (err?.code !== 'P2002') throw err;
        const current = await prisma.comment.findUnique({
          where: { id: commentId },
          select: { likeCount: true },
        });
        likedByMe = true;
        likeCount = current?.likeCount ?? comment.likeCount;
        res.json({ likedByMe, likeCount });
        return;
      }

      // "X liked your comment". A failed notification must never undo the like.
      try {
        await notify({
          recipientId: comment.userId,
          actorId: user.id,
          type: 'COMMENT_LIKE',
          articleId: comment.articleId,
          articleTitle: comment.articleTitle,
          commentId: comment.id,
          preview: comment.body,
        });
      } catch (err) {
        console.error('[comments] like notification failed', err);
      }
    }

    res.json({ likedByMe, likeCount });
  })
);

// GET /api/comments/:commentId/likes (public list of who liked it)
commentsRouter.get(
  '/comments/:commentId/likes',
  asyncHandler(async (req, res) => {
    const { commentId } = req.params;
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null;
    const limit = 50;

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, deletedAt: true, likeCount: true },
    });
    if (!comment || comment.deletedAt) {
      throw new ApiError('not_found', 'That comment no longer exists.');
    }

    const rows = await prisma.commentLike.findMany({
      where: { commentId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { user: { select: AUTHOR_SELECT } },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    res.json({
      likeCount: comment.likeCount,
      likes: page.map((like) => ({
        user: toPublicAuthor(like.user),
        likedAt: like.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    });
  })
);

// DELETE /api/comments/:commentId (Soft delete)
commentsRouter.delete(
  '/comments/:commentId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const { commentId } = req.params;

    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.deletedAt) {
      throw new ApiError('not_found', 'That comment no longer exists.');
    }

    if (comment.userId !== user.id && user.role !== 'ADMIN') {
      throw new ApiError('forbidden', 'You can only delete your own comments.');
    }

    await prisma.$transaction([
      prisma.comment.update({
        where: { id: commentId },
        data: { deletedAt: new Date() },
      }),
      prisma.articleStat.updateMany({
        where: { articleId: comment.articleId },
        data: { commentCount: { decrement: 1 } },
      }),
      ...(comment.parentId
        ? [
            prisma.comment.update({
              where: { id: comment.parentId },
              data: { replyCount: { decrement: 1 } },
            }),
          ]
        : []),
    ]);

    res.json({ ok: true, commentId });
  })
);

// GET /api/articles/:articleId/comments
commentsRouter.get(
  '/articles/:articleId/comments',
  asyncHandler(async (req, res) => {
    const { articleId } = req.params;
    const currentUser = await getUserFromRequest(req);
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null;

    // Same helper the engagement layer already uses: adds likedByMe, likedBy
    // and canDelete for the current viewer, which the UI needs to show state.
    const thread = await getArticleThread(articleId, currentUser?.id ?? null, {
      isAdmin: currentUser?.role === 'ADMIN',
      cursor,
    });

    res.json(thread);
  })
);

// POST /api/articles/:articleId/comments
commentsRouter.post(
  '/articles/:articleId/comments',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const { articleId } = req.params;
    const { body, parentId, articleTitle, articleLocation } = req.body;

    if (!body || typeof body !== 'string' || !body.trim()) {
      throw new ApiError('invalid_request', 'Comment body cannot be empty.');
    }

    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          articleId,
          articleTitle: articleTitle || null,
          articleLocation: articleLocation || null,
          userId: user.id,
          body: body.trim(),
          parentId: parentId || null,
        },
        include: { user: { select: AUTHOR_SELECT } },
      });

      await tx.articleStat.upsert({
        where: { articleId },
        create: { articleId, commentCount: 1 },
        update: { commentCount: { increment: 1 } },
      });

      if (parentId) {
        await tx.comment.update({
          where: { id: parentId },
          data: { replyCount: { increment: 1 } },
        });
      }

      return created;
    });

    res.status(201).json({
      comment: {
        id: comment.id,
        body: comment.body,
        createdAt: comment.createdAt.toISOString(),
        author: toPublicAuthor(comment.user),
        likeCount: 0,
        replyCount: 0,
      },
    });
  })
);
