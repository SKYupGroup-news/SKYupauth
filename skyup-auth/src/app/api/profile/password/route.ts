import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/current-user';
import { ApiError, handleRoute, parseJson } from '@/lib/http';
import { hashPassword, verifyPassword } from '@/lib/password';
import { revokeAllSessions } from '@/lib/session';
import { changePasswordSchema } from '@/lib/validation';

export const POST = handleRoute(async (request: Request) => {
  const current = await requireUser(request);
  const { currentPassword, newPassword } = await parseJson(request, changePasswordSchema);

  const user = await prisma.user.findUnique({ where: { id: current.id } });

  // A phone-only or OAuth-only reader has no password to change; they must set
  // one through the reset-by-email flow instead.
  if (!user?.passwordHash) {
    throw new ApiError(
      'invalid_request',
      'This account has no password set. Use the password reset flow instead.',
    );
  }

  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new ApiError('invalid_credentials', 'Your current password is incorrect.');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  // Same reasoning as a reset: a password change should evict every other device.
  await revokeAllSessions(user.id);

  return NextResponse.json({
    ok: true,
    message: 'Password changed. Please sign in again.',
  });
});
