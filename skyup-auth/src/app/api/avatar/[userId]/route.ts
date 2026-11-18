import { prisma } from '@/lib/db';
import { handleRoute } from '@/lib/http';
import { getAvatar } from '@/lib/avatar-store';

/**
 * Serves an uploaded profile picture.
 *
 * Unauthenticated on purpose: an avatar is shown publicly beside comments, and
 * ids are unguessable cuids. Nothing else about the reader is exposed here.
 */
export const GET = handleRoute(
  async (request: Request, ctx: { params: Promise<{ userId: string }> }) => {
    const { userId } = await ctx.params;

    const row = await prisma.userAvatar.findUnique({
      where: { userId },
      select: { updatedAt: true },
    });
    if (!row) {
      return new Response('Not found', { status: 404 });
    }

    const avatar = await getAvatar(userId);
    if (!avatar) {
      return new Response('Not found', { status: 404 });
    }

    const etag = `"${row.updatedAt.getTime()}"`;
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }

    return new Response(new Uint8Array(avatar.data), {
      headers: {
        'Content-Type': avatar.mimeType,
        'Content-Length': String(avatar.data.length),
        ETag: etag,
        // Revalidate every time: the URL is stable, so a changed picture must
        // not be served from a stale cache.
        'Cache-Control': 'private, no-cache, must-revalidate',
      },
    });
  },
);
