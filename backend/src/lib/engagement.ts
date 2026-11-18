import { prisma } from './db';
import { avatarSrcFor } from './current-user';
import type { Comment, NotificationType, User } from '@/generated/prisma';

/** How a commenter is shown to other readers. */
export interface PublicAuthor {
  id: string;
  name: string;
  avatarSrc: string | null;
}

type AuthorRow = Pick<
  User,
  'id' | 'displayName' | 'email' | 'phone' | 'avatarUrl' | 'avatarUpdatedAt'
>;

export const AUTHOR_SELECT = {
  id: true,
  displayName: true,
  email: true,
  phone: true,
  avatarUrl: true,
  avatarUpdatedAt: true,
} as const;

/**
 * Names shown beside public comments must never leak an identifier the reader
 * did not choose to publish, so an unnamed account falls back to "Reader"
 * rather than exposing their email or phone number.
 */
export function toPublicAuthor(user: AuthorRow): PublicAuthor {
  return {
    id: user.id,
    name: user.displayName?.trim() || 'Reader',
    avatarSrc: avatarSrcFor(user),
  };
}

export interface CommentNode {
  id: string;
  body: string | null;
  author: PublicAuthor;
  articleId: string;
  parentId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deleted: boolean;
  likeCount: number;
  replyCount: number;
  likedByMe: boolean;
  /// First few likers, newest first, for an inline "liked by ..." line.
  /// The full list comes from GET /api/comments/{id}/likes.
  likedBy: PublicAuthor[];
  /** Whether the current viewer may delete it. */
  canDelete: boolean;
  replies: CommentNode[];
}

type CommentRow = Comment & {
  user: AuthorRow;
  likes: Array<{ user: AuthorRow }>;
};

function toNode(
  row: CommentRow,
  viewerId: string | null,
  isAdmin: boolean,
  likedCommentIds: Set<string>,
): CommentNode {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    // The row survives deletion to keep replies threaded; the text does not.
    body: deleted ? null : row.body,
    author: toPublicAuthor(row.user),
    articleId: row.articleId,
    parentId: row.parentId,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    deleted,
    // A withdrawn comment exposes no engagement at all. Leaving the liker
    // preview visible would leak names the dedicated endpoint already 404s on.
    likeCount: deleted ? 0 : row.likeCount,
    replyCount: row.replyCount,
    likedByMe: !deleted && likedCommentIds.has(row.id),
    likedBy: deleted ? [] : row.likes.map((like) => toPublicAuthor(like.user)),
    canDelete: !deleted && viewerId !== null && (row.userId === viewerId || isAdmin),
    replies: [],
  };
}

/** Top-level comments per page, and replies shown inline before "view more". */
export const THREAD_PAGE_SIZE = 20;
export const INLINE_REPLIES = 3;
export const LIKER_PREVIEW = 3;

const THREAD_INCLUDE = {
  user: { select: AUTHOR_SELECT },
  likes: {
    take: LIKER_PREVIEW,
    orderBy: { createdAt: 'desc' },
    select: { user: { select: AUTHOR_SELECT } },
  },
} as const;

/**
 * One page of an article's thread.
 *
 * Loading a whole thread used to work only while threads were small: at 40k
 * comments Prisma could not even build the query (P2029 — too many bind
 * parameters), so the endpoint returned 500 rather than merely being slow.
 * Roots are paged with a cursor and each carries a few inline replies; the
 * rest are fetched per-parent on demand.
 */
export async function getArticleThread(
  articleId: string,
  viewerId: string | null,
  options: { isAdmin?: boolean; limit?: number; cursor?: string | null } = {},
): Promise<{ comments: CommentNode[]; nextCursor: string | null }> {
  const isAdmin = options.isAdmin ?? false;
  const limit = Math.min(50, Math.max(1, options.limit ?? THREAD_PAGE_SIZE));

  const roots = await prisma.comment.findMany({
    where: { articleId, parentId: null },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    include: {
      ...THREAD_INCLUDE,
      replies: {
        orderBy: { createdAt: 'asc' },
        take: INLINE_REPLIES,
        include: THREAD_INCLUDE,
      },
    },
  });

  const hasMore = roots.length > limit;
  const page = hasMore ? roots.slice(0, limit) : roots;

  // Only the ids actually on this page, so the lookup does not scan every like
  // on a hot article.
  const ids = page.flatMap((root) => [root.id, ...root.replies.map((r) => r.id)]);

  const myLikes =
    viewerId && ids.length
      ? await prisma.commentLike.findMany({
          where: { userId: viewerId, commentId: { in: ids } },
          select: { commentId: true },
        })
      : [];
  const liked = new Set(myLikes.map((like) => like.commentId));

  const comments = page.map((root) => ({
    ...toNode(root as unknown as CommentRow, viewerId, isAdmin, liked),
    replies: root.replies.map((reply) =>
      toNode(reply as unknown as CommentRow, viewerId, isAdmin, liked),
    ),
  }));

  return {
    comments,
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

/** Remaining replies under one comment, oldest first. */
export async function getReplies(
  parentId: string,
  viewerId: string | null,
  options: { isAdmin?: boolean; limit?: number; cursor?: string | null } = {},
): Promise<{ replies: CommentNode[]; nextCursor: string | null }> {
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));

  const rows = await prisma.comment.findMany({
    where: { parentId },
    orderBy: { createdAt: 'asc' },
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    include: THREAD_INCLUDE,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const myLikes =
    viewerId && page.length
      ? await prisma.commentLike.findMany({
          where: { userId: viewerId, commentId: { in: page.map((r) => r.id) } },
          select: { commentId: true },
        })
      : [];
  const liked = new Set(myLikes.map((like) => like.commentId));

  return {
    replies: page.map((row) =>
      toNode(row as unknown as CommentRow, viewerId, options.isAdmin ?? false, liked),
    ),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

/**
 * Records a notification for the owner of the thing that was acted on.
 * Self-actions are ignored: liking your own comment should not notify you.
 */
export async function notify(input: {
  recipientId: string;
  actorId: string;
  type: NotificationType;
  articleId?: string | null;
  articleTitle?: string | null;
  commentId?: string | null;
  preview?: string | null;
}): Promise<void> {
  if (input.recipientId === input.actorId) return;

  await prisma.notification.create({
    data: {
      userId: input.recipientId,
      actorId: input.actorId,
      type: input.type,
      articleId: input.articleId ?? null,
      articleTitle: input.articleTitle ?? null,
      commentId: input.commentId ?? null,
      preview: input.preview?.slice(0, 140) ?? null,
    },
  });
}

/** Everything a reader's own profile needs: what they liked and what they wrote. */
export async function getMyEngagement(userId: string) {
  const [likes, comments, unreadCount] = await Promise.all([
    prisma.articleLike.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.comment.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { _count: { select: { likes: true, replies: true } } },
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  return {
    likedArticleIds: likes.map((like) => like.articleId),
    likes: likes.map((like) => ({
      articleId: like.articleId,
      articleTitle: like.articleTitle,
      createdAt: like.createdAt,
    })),
    comments: comments.map((comment) => ({
      id: comment.id,
      articleId: comment.articleId,
      articleTitle: comment.articleTitle,
      text: comment.body,
      parentId: comment.parentId,
      createdAt: comment.createdAt,
      likeCount: comment._count.likes,
      replyCount: comment._count.replies,
    })),
    unreadNotifications: unreadCount,
  };
}
