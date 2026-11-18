import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleRoute, parseJson } from '@/lib/http';
import { hashPassword } from '@/lib/password';
import { revokeAllSessions } from '@/lib/session';
import { resetPasswordSchema } from '@/lib/validation';
import { consumeVerificationToken } from '@/lib/verification';

export const POST = handleRoute(async (request: Request) => {
  const { token, password } = await parseJson(request, resetPasswordSchema);
  const userId = await consumeVerificationToken(token, 'PASSWORD_RESET');

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(password),
      // Reaching this link proves control of the mailbox.
      emailVerifiedAt: new Date(),
    },
  });

  // A reset is the standard response to a suspected compromise, so every
  // existing session must die with the old password.
  await revokeAllSessions(userId);

  return NextResponse.json({
    ok: true,
    message: 'Password updated. Please sign in again.',
  });
});
