import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleRoute } from '@/lib/http';
import { AUTHOR_SELECT, toPublicAuthor } from '@/lib/engagement';

const PAGE_SIZE = 50;

/** Who liked an article. Public, on the same basis as comment likers. */
export const GET = handleRoute(
  async (request: Request, ctx: { params: Promise<{ articleId: string }> }) => {
    const { articleId } = await ctx.params;
    const url = new URL(request.url);
    const cursor = url.searchParams.get('cursor');
    const limit = Math.min(
      PAGE_SIZE,
      Number(url.searchParams.get('limit') ?? PAGE_SIZE) || PAGE_SIZE,
    );

    const [likeCount, rows] = await Promise.all([
      prisma.articleLike.count({ where: { articleId } }),
      prisma.articleLike.findMany({
        where: { articleId },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: { user: { select: AUTHOR_SELECT } },
      }),
    ]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return NextResponse.json({
      articleId,
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
