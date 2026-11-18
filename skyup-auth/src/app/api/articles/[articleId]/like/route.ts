import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getCurrentUser, requireUser } from '@/lib/current-user';
import { handleRoute } from '@/lib/http';

const bodySchema = z.object({ articleTitle: z.string().trim().max(512).optional() });

/** Like state for this article: total count, and whether the viewer liked it. */
export const GET = handleRoute(
  async (request: Request, ctx: { params: Promise<{ articleId: string }> }) => {
    const { articleId } = await ctx.params;
    const viewer = await getCurrentUser(request);

    const [stat, mine] = await Promise.all([
      prisma.articleStat.findUnique({ where: { articleId }, select: { likeCount: true } }),
      viewer
        ? prisma.articleLike.findUnique({
            where: { userId_articleId: { userId: viewer.id, articleId } },
          })
        : null,
    ]);

    return NextResponse.json({
      articleId,
      likeCount: stat?.likeCount ?? 0,
      likedByMe: mine !== null,
    });
  },
);

/** Toggles the viewer's like. Idempotent per reader thanks to the unique index. */
export const POST = handleRoute(
  async (request: Request, ctx: { params: Promise<{ articleId: string }> }) => {
    const user = await requireUser(request);
    const { articleId } = await ctx.params;

    const body = await request.json().catch(() => ({}));
    const { articleTitle } = bodySchema.parse(body ?? {});

    const existing = await prisma.articleLike.findUnique({
      where: { userId_articleId: { userId: user.id, articleId } },
    });

    // Counted rows do not survive a viral article; the rollup is authoritative
    // and moves inside the same transaction as the like itself.
    const [, stat] = existing
      ? await prisma.$transaction([
          prisma.articleLike.delete({ where: { id: existing.id } }),
          prisma.articleStat.upsert({
            where: { articleId },
            create: { articleId, articleTitle: articleTitle ?? null, likeCount: 0 },
            update: { likeCount: { decrement: 1 } },
          }),
        ])
      : await prisma.$transaction([
          prisma.articleLike.create({
            data: { userId: user.id, articleId, articleTitle: articleTitle ?? null },
          }),
          prisma.articleStat.upsert({
            where: { articleId },
            create: { articleId, articleTitle: articleTitle ?? null, likeCount: 1 },
            update: { likeCount: { increment: 1 } },
          }),
        ]);

    return NextResponse.json({
      articleId,
      likedByMe: existing === null,
      likeCount: Math.max(0, stat.likeCount),
    });
  },
);
