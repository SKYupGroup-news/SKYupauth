import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/current-user';
import { ApiError, handleRoute } from '@/lib/http';
import { notify } from '@/lib/engagement';

/** Toggles a like on a comment, notifying its author the first time. */
export const POST = handleRoute(
  async (request: Request, ctx: { params: Promise<{ commentId: string }> }) => {
    const user = await requireUser(request);
    const { commentId } = await ctx.params;

    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.deletedAt) {
      throw new ApiError('not_found', 'That comment no longer exists.');
    }

    const existing = await prisma.commentLike.findUnique({
      where: { userId_commentId: { userId: user.id, commentId } },
    });

    // The like row and the counter move together, so the number on screen can
    // never disagree with the rows behind it.
    if (existing) {
      await prisma.$transaction([
        prisma.commentLike.delete({ where: { id: existing.id } }),
        prisma.comment.update({
          where: { id: commentId },
          data: { likeCount: { decrement: 1 } },
        }),
      ]);
    } else {
      await prisma.$transaction([
        prisma.commentLike.create({ data: { userId: user.id, commentId } }),
        prisma.comment.update({
          where: { id: commentId },
          data: { likeCount: { increment: 1 } },
        }),
      ]);
      await notify({
        recipientId: comment.userId,
        actorId: user.id,
        type: 'COMMENT_LIKE',
        articleId: comment.articleId,
        articleTitle: comment.articleTitle,
        commentId: comment.id,
        preview: comment.body,
      });
    }

    const updated = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { likeCount: true },
    });

    return NextResponse.json({
      commentId,
      likedByMe: existing === null,
      likeCount: updated?.likeCount ?? 0,
    });
  },
);
