import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleRoute, parseJson } from '@/lib/http';
import { verifyEmailSchema } from '@/lib/validation';
import { consumeVerificationToken } from '@/lib/verification';

export const POST = handleRoute(async (request: Request) => {
  const { token } = await parseJson(request, verifyEmailSchema);
  const userId = await consumeVerificationToken(token, 'EMAIL_VERIFICATION');

  await prisma.user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
});
