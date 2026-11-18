import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getCurrentUser, requireUser } from '@/lib/current-user';
import { ApiError, handleRoute, parseJson } from '@/lib/http';
import { AUTHOR_SELECT, getArticleThread, notify, toPublicAuthor } from '@/lib/engagement';

const createSchema = z.object({
  body: z.string().trim().min(1, 'Write something first.').max(2000, 'Comments are limited to 2000 characters.'),
  parentId: z.string().min(1).optional(),
  articleTitle: z.string().trim().max(512).optional(),
  /// The story's dateline, snapshotted so moderation can filter by it.
  articleLocation: z.string().trim().max(160).optional(),
});

/** The whole thread. Readable signed-out so guests can read the discussion. */
export const GET = handleRoute(
  async (request: Request, ctx: { params: Promise<{ articleId: string }> }) => {
    const { articleId } = await ctx.params;
    const viewer = await getCurrentUser(request);

    const url = new URL(request.url);

    const { comments, nextCursor } = await getArticleThread(articleId, viewer?.id ?? null, {
      isAdmin: viewer?.role === 'ADMIN',
      limit: Number(url.searchParams.get('limit')) || undefined,
      cursor: url.searchParams.get('cursor'),
    });

    // Read from the rollup instead of counting 40k rows on every page view.
    const stat = await prisma.articleStat.findUnique({ where: { articleId } });

    return NextResponse.json({
      articleId,
      total: stat?.commentCount ?? 0,
      comments,
      nextCursor,
    });
  },
);

export const POST = handleRoute(
  async (request: Request, ctx: { params: Promise<{ articleId: string }> }) => {
    const user = await requireUser(request);
    const { articleId } = await ctx.params;
    const input = await parseJson(request, createSchema);

    let parent = null;
    if (input.parentId) {
      parent = await prisma.comment.findUnique({ where: { id: input.parentId } });
      // A reply must belong to the same article, or threads could be spliced
      // across articles by passing an arbitrary parent id.
      if (!parent || parent.articleId !== articleId) {
        throw new ApiError('not_found', 'That comment no longer exists.');
      }
    }

    const title = input.articleTitle ?? parent?.articleTitle ?? null;
    // A reply inherits its parent's dateline when the client does not send one.
    const location = input.articleLocation ?? parent?.articleLocation ?? null;

    // Comment, parent counter and article rollup all move together.
    const [created] = await prisma.$transaction([
      prisma.comment.create({
        data: {
          userId: user.id,
          articleId,
          articleTitle: title,
          articleLocation: location,
          parentId: parent?.id ?? null,
          body: input.body,
        },
        include: { user: { select: AUTHOR_SELECT } },
      }),
      prisma.articleStat.upsert({
        where: { articleId },
        create: { articleId, articleTitle: title, articleLocation: location, commentCount: 1 },
        update: {
          commentCount: { increment: 1 },
          // Backfills the rollup's location the first time a client sends one.
          ...(location ? { articleLocation: location } : {}),
        },
      }),
      ...(parent
        ? [
            prisma.comment.update({
              where: { id: parent.id },
              data: { replyCount: { increment: 1 } },
            }),
          ]
        : []),
    ]);

    if (parent) {
      await notify({
        recipientId: parent.userId,
        actorId: user.id,
        type: 'COMMENT_REPLY',
        articleId,
        articleTitle: created.articleTitle,
        commentId: created.id,
        preview: input.body,
      });
    }

    return NextResponse.json(
      {
        comment: {
          id: created.id,
          body: created.body,
          author: toPublicAuthor(created.user),
          articleId: created.articleId,
          parentId: created.parentId,
          createdAt: created.createdAt,
          editedAt: null,
          deleted: false,
          likeCount: 0,
          likedByMe: false,
          likedBy: [],
          replyCount: 0,
          canDelete: true,
          replies: [],
        },
      },
      { status: 201 },
    );
  },
);
