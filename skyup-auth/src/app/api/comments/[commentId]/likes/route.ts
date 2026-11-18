import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { ApiError, handleRoute } from '@/lib/http';
import { AUTHOR_SELECT, toPublicAuthor } from '@/lib/engagement';

const PAGE_SIZE = 50;

/**
 * Who liked a comment.
 *
 * Public by product decision: any reader (signed in or not) can see the list,
 * matching the visibility of the thread itself. Only the narrow public author
 * shape is returned — never email or phone.
 */
export const GET = handleRoute(
  async (request: Request, ctx: { params: Promise<{ commentId: string }> }) => {
    const { commentId } = await ctx.params;
    const url = new URL(request.url);
    const cursor = url.searchParams.get('cursor');
    const limit = Math.min(
      PAGE_SIZE,
      Number(url.searchParams.get('limit') ?? PAGE_SIZE) || PAGE_SIZE,
    );

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, deletedAt: true },
    });

    // A withdrawn comment exposes nothing further, its likers included.
    if (!comment || comment.deletedAt) {
      throw new ApiError('not_found', 'That comment no longer exists.');
    }

    const [likeCount, rows] = await Promise.all([
      prisma.commentLike.count({ where: { commentId } }),
      prisma.commentLike.findMany({
        where: { commentId },
        orderBy: { createdAt: 'desc' },
        // Fetch one extra to learn whether another page exists.
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: { user: { select: AUTHOR_SELECT } },
      }),
    ]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return NextResponse.json({
      commentId,
      likeCount,
      likes: page.map((row) => ({
        id: row.id,
        user: toPublicAuthor(row.user),
        likedAt: row.createdAt,
      })),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    });
  },
);
