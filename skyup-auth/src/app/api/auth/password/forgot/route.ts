import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { clientIp, handleRoute, parseJson } from '@/lib/http';
import { passwordResetEmail, sendEmail } from '@/lib/mailer';
import { RULES, consumeRateLimit } from '@/lib/rate-limit';
import { forgotPasswordSchema } from '@/lib/validation';
import { issueVerificationToken } from '@/lib/verification';

export const POST = handleRoute(async (request: Request) => {
  await consumeRateLimit(RULES.passwordForgot, clientIp(request));

  const { email } = await parseJson(request, forgotPasswordSchema);
  const user = await prisma.user.findUnique({ where: { email } });

  // Only send when the account exists and can actually use a password, but
  // always return the same response so this endpoint cannot be used to
  // enumerate which emails are registered.
  if (user && user.status === 'ACTIVE') {
    const token = await issueVerificationToken(user.id, 'PASSWORD_RESET');
    await sendEmail(
      passwordResetEmail(
        email,
        `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`,
      ),
    );
  }

  return NextResponse.json({
    ok: true,
    message: 'If that email is registered, a reset link is on its way.',
  });
});
