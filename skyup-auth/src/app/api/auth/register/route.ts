import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { ApiError, clientIp, handleRoute, parseJson } from '@/lib/http';
import { verificationEmail, sendEmail } from '@/lib/mailer';
import { hashPassword } from '@/lib/password';
import { RULES, consumeRateLimit } from '@/lib/rate-limit';
import { createSession, setAuthCookies } from '@/lib/session';
import { toPublicUser } from '@/lib/current-user';
import { registerSchema } from '@/lib/validation';
import { issueVerificationToken } from '@/lib/verification';

export const POST = handleRoute(async (request: Request) => {
  await consumeRateLimit(RULES.register, clientIp(request));

  const { email, password, displayName } = await parseJson(request, registerSchema);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new ApiError('conflict', 'An account with that email already exists.');
  }

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      displayName: displayName ?? null,
    },
  });

  const token = await issueVerificationToken(user.id, 'EMAIL_VERIFICATION');
  await sendEmail(
    verificationEmail(email, `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`),
  );

  // Sign the user in right away; the unverified state is surfaced on the user
  // object so the UI can nudge them without blocking access to the site.
  const tokens = await createSession(user, request);

  return setAuthCookies(
    NextResponse.json(
      {
        user: toPublicUser(user),
        accessToken: tokens.accessToken,
        expiresIn: tokens.accessTokenExpiresIn,
      },
      { status: 201 },
    ),
    tokens,
  );
});
