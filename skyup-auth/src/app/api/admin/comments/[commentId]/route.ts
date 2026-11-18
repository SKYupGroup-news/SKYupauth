import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/current-user';
import { ApiError, handleRoute } from '@/lib/http';

/**
 * Permanently deletes a comment from the database (hard delete).
 * Only accessible to administrators.
 */
export const DELETE = handleRoute(
  async (request: Request, ctx: { params: Promise<{ commentId: string }> }) => {
    const actor = await requireUser(request);
    if (actor.role !== 'ADMIN') {
      throw new ApiError('forbidden', 'Only administrators can permanently delete comments.');
    }

    const { commentId } = await ctx.params;
    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) {
      throw new ApiError('not_found', 'No such comment.');
    }

    // If the comment wasn't soft-deleted yet, adjust counters before permanently removing it
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
      prisma.comment.delete({
        where: { id: commentId },
      }),
    ]);

    return NextResponse.json({ ok: true, commentId, permanentlyDeleted: true });
  },
);
