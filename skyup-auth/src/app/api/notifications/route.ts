import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/current-user';
import { handleRoute, parseJson } from '@/lib/http';
import { AUTHOR_SELECT, toPublicAuthor } from '@/lib/engagement';

/** "Who liked my comment" / "who replied to me", newest first. */
export const GET = handleRoute(async (request: Request) => {
  const user = await requireUser(request);
  const limit = Math.min(100, Number(new URL(request.url).searchParams.get('limit') ?? '50') || 50);

  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { actor: { select: AUTHOR_SELECT } },
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  return NextResponse.json({
    unreadCount,
    notifications: rows.map((row) => ({
      id: row.id,
      type: row.type,
      actor: toPublicAuthor(row.actor),
      articleId: row.articleId,
      articleTitle: row.articleTitle,
      commentId: row.commentId,
      preview: row.preview,
      read: row.readAt !== null,
      createdAt: row.createdAt,
      message:
        row.type === 'COMMENT_LIKE'
          ? `${toPublicAuthor(row.actor).name} liked your comment`
          : `${toPublicAuthor(row.actor).name} replied to your comment`,
    })),
  });
});

const readSchema = z.object({
  // Omit to mark everything read.
  ids: z.array(z.string().min(1)).max(200).optional(),
});

export const POST = handleRoute(async (request: Request) => {
  const user = await requireUser(request);
  const { ids } = await parseJson(request, readSchema);

  const result = await prisma.notification.updateMany({
    // Always scoped to the caller, so passing someone else's ids marks nothing.
    where: { userId: user.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ ok: true, marked: result.count });
});
