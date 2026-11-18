import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/current-user';
import { ApiError, handleRoute, parseJson } from '@/lib/http';
import { verifyPassword } from '@/lib/password';
import { clearAuthCookies, revokeAllSessions } from '@/lib/session';
import { deleteAvatar } from '@/lib/avatar-store';
import { dropCachedSessionsForUser } from '@/lib/session-cache';

const schema = z.object({
  /// Typed confirmation, so a mis-click cannot erase an account.
  confirm: z.literal('DELETE MY ACCOUNT'),
  /// Required when the account has one; re-authentication for a one-way action.
  password: z.string().optional(),
});

/**
 * Erases the signed-in reader's account.
 *
 * Their own content is removed with them (cascade), but other readers' content
 * is not: replies written BY other people to a deleted person's comment survive
 * as withdrawn-parent threads, because one person leaving must not silently
 * delete someone else's words.
 *
 * Invoices are the one deliberate exception — financial records are kept, with
 * the identifying link severed, because tax law requires retaining them.
 */
export const POST = handleRoute(async (request: Request) => {
  const user = await requireUser(request);
  const { password } = await parseJson(request, schema);

  const record = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

  if (record.passwordHash) {
    if (!password) {
      throw new ApiError('invalid_request', 'Enter your password to confirm deletion.');
    }
    if (!(await verifyPassword(record.passwordHash, password))) {
      throw new ApiError('invalid_credentials', 'That password is not correct.');
    }
  }

  // Keep the invoice rows, drop the person they point at.
  const retainedInvoices = await prisma.invoice.count({ where: { userId: user.id } });

  await deleteAvatar(user.id).catch(() => {});
  await revokeAllSessions(user.id);
  await dropCachedSessionsForUser(user.id);

  await prisma.$transaction([
    // Anonymise rather than delete, so the financial record survives the person.
    prisma.$executeRaw`
      UPDATE invoices SET "userId" = NULL WHERE "userId" = ${user.id}
    `,
    prisma.user.delete({ where: { id: user.id } }),
  ]);

  return clearAuthCookies(
    NextResponse.json({
      ok: true,
      message: 'Your account and personal data have been deleted.',
      retainedInvoices,
      retentionNote:
        retainedInvoices > 0
          ? 'Payment records are retained without any link to you, as financial law requires.'
          : undefined,
    }),
  );
});
