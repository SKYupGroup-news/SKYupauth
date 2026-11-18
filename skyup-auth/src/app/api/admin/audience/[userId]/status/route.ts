import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/current-user';
import { ApiError, handleRoute, parseJson } from '@/lib/http';
import { revokeAllSessions } from '@/lib/session';
import { dropCachedSessionsForUser } from '@/lib/session-cache';
import { AUTHOR_SELECT, toPublicAuthor } from '@/lib/engagement';

const schema = z.object({
  action: z.enum(['SUSPEND', 'REINSTATE']),
  // Required for both directions: reinstating without a note leaves the next
  // reviewer unable to tell whether the original suspension was a mistake.
  reason: z
    .string()
    .trim()
    .min(5, 'Give a reason of at least 5 characters.')
    .max(500, 'Reasons are limited to 500 characters.'),
});

export const POST = handleRoute(
  async (request: Request, ctx: { params: Promise<{ userId: string }> }) => {
    const actor = await requireUser(request);
    if (actor.role !== 'ADMIN') {
      throw new ApiError('forbidden', 'Only administrators can change account status.');
    }

    const { userId } = await ctx.params;
    const { action, reason } = await parseJson(request, schema);

    // Suspending yourself would lock you out of the console that undoes it.
    if (userId === actor.id) {
      throw new ApiError('invalid_request', 'You cannot change your own account status.');
    }

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new ApiError('not_found', 'No such reader.');

    const nextStatus = action === 'SUSPEND' ? 'SUSPENDED' : 'ACTIVE';
    if (target.status === nextStatus) {
      throw new ApiError(
        'conflict',
        action === 'SUSPEND'
          ? 'That account is already suspended.'
          : 'That account is already active.',
      );
    }

    // Status change and audit row commit together: a suspension must never
    // exist without the record of who made it and why.
    const [updated, entry] = await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { status: nextStatus } }),
      prisma.accountAction.create({
        data: { userId, actorId: actor.id, type: action, reason },
        include: { actor: { select: AUTHOR_SELECT } },
      }),
    ]);

    // Suspension takes effect immediately rather than when the access token
    // expires. (getCurrentUser also re-checks status on every request.)
    if (action === 'SUSPEND') {
      // Revoking also drops the cached sessions, so the block is immediate.
      await revokeAllSessions(userId);
    } else {
      // Reinstating changes the cached user's status; evict so the next request
      // reads the new one rather than a stale "suspended" entry.
      await dropCachedSessionsForUser(userId);
    }

    return NextResponse.json({
      ok: true,
      userId,
      status: updated.status,
      action: {
        id: entry.id,
        type: entry.type,
        reason: entry.reason,
        actor: toPublicAuthor(entry.actor),
        createdAt: entry.createdAt,
      },
    });
  },
);
