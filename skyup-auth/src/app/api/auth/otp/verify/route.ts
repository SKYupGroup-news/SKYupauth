import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { ApiError, clientIp, handleRoute, parseJson } from '@/lib/http';
import { verifyOtp } from '@/lib/otp';
import { RULES, consumeRateLimit, resetRateLimit } from '@/lib/rate-limit';
import { createSession, setAuthCookies } from '@/lib/session';
import { toPublicUser } from '@/lib/current-user';
import { otpVerifySchema } from '@/lib/validation';

export const POST = handleRoute(async (request: Request) => {
  const ip = clientIp(request);
  const { phone, code, adminOnly } = await parseJson(request, otpVerifySchema);

  await consumeRateLimit(RULES.otpVerify, phone);
  await consumeRateLimit(RULES.otpVerify, ip);

  await verifyOtp(phone, 'PHONE_LOGIN', code);
  await resetRateLimit(RULES.otpVerify, phone);

  // Phone-first sign-up: a verified code for an unknown number creates the
  // account, so there is no separate "register with phone" step.
  const now = new Date();
  const user = await prisma.user.upsert({
    where: { phone },
    update: { phoneVerifiedAt: now },
    create: { phone, phoneVerifiedAt: now },
  });

  if (user.status !== 'ACTIVE') {
    throw new ApiError('forbidden', 'This account has been suspended.');
  }

  if (adminOnly && user.role !== 'ADMIN') {
    throw new ApiError(
      'forbidden',
      'Audience customer accounts cannot sign in to this internal management software. Please sign in to the audience news project at http://localhost:3000.',
    );
  }

  const tokens = await createSession(user, request);

  return setAuthCookies(
    NextResponse.json({
      user: toPublicUser(user),
      accessToken: tokens.accessToken,
      expiresIn: tokens.accessTokenExpiresIn,
    }),
    tokens,
  );
});
