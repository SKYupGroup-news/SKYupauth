import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/current-user';
import { ApiError, handleRoute } from '@/lib/http';

/**
 * Undoes a removal. Possible because deletion is soft — the row and its replies
 * were never destroyed, so a mistaken takedown is recoverable.
 */
export const POST = handleRoute(
  async (request: Request, ctx: { params: Promise<{ commentId: string }> }) => {
    const actor = await requireUser(request);
    if (actor.role !== 'ADMIN') {
      throw new ApiError('forbidden', 'Only administrators can restore comments.');
    }

    const { commentId } = await ctx.params;
    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) throw new ApiError('not_found', 'No such comment.');
    if (!comment.deletedAt) {
      throw new ApiError('conflict', 'That comment is not removed.');
    }

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

    return NextResponse.json({ ok: true, commentId, deleted: false });
  },
);
