import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/current-user';
import { handleRoute } from '@/lib/http';
import { getReplies } from '@/lib/engagement';

/** "View more replies" — the rest of a thread under one comment. */
export const GET = handleRoute(
  async (request: Request, ctx: { params: Promise<{ commentId: string }> }) => {
    const { commentId } = await ctx.params;
    const viewer = await getCurrentUser(request);
    const url = new URL(request.url);

    const { replies, nextCursor } = await getReplies(commentId, viewer?.id ?? null, {
      isAdmin: viewer?.role === 'ADMIN',
      limit: Number(url.searchParams.get('limit')) || undefined,
      cursor: url.searchParams.get('cursor'),
    });

    return NextResponse.json({ commentId, replies, nextCursor });
  },
);
