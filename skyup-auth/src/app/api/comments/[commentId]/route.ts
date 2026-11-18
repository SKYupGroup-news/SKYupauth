import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/current-user';
import { ApiError, handleRoute } from '@/lib/http';

/**
 * Soft-deletes a comment. The row stays so any replies remain threaded and
 * readable; only the text is withdrawn.
 */
export const DELETE = handleRoute(
  async (request: Request, ctx: { params: Promise<{ commentId: string }> }) => {
    const user = await requireUser(request);
    const { commentId } = await ctx.params;

    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.deletedAt) {
      throw new ApiError('not_found', 'That comment no longer exists.');
    }

    // Authors delete their own; moderators delete anyone's.
    if (comment.userId !== user.id && user.role !== 'ADMIN') {
      throw new ApiError('forbidden', 'You can only delete your own comments.');
    }

    // Withdrawing the text also withdraws what it contributed to the counters.
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

    return NextResponse.json({ ok: true, commentId });
  },
);
