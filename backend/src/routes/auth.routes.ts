import { Router } from 'express';
import { prisma } from '@/lib/db';
import { ApiError, asyncHandler, clientIp } from '@/lib/http';
import { fakeVerify, hashPassword, verifyPassword } from '@/lib/password';
import { RULES, consumeRateLimit } from '@/lib/rate-limit';
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  createSession,
  revokeSessionByToken,
  rotateSession,
  setAuthCookies,
} from '@/lib/session';
import { getUserFromRequest, toPublicUser } from '@/lib/current-user';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  otpRequestSchema,
  otpVerifySchema,
} from '@/lib/validation';
import { passwordResetEmail, sendEmail, verificationEmail } from '@/lib/mailer';
import {
  consumeVerificationToken,
  issueVerificationToken,
} from '@/lib/verification';
import { issueOtp, verifyOtp } from '@/lib/otp';
import { env } from '@/lib/env';

export const authRouter = Router();

// POST /api/auth/register
authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const ip = clientIp(req);
    await consumeRateLimit(RULES.register, ip);

    const data = registerSchema.parse(req.body);
    const email = data.email.trim().toLowerCase();

    const existing = await prisma.user.findFirst({
      where: { email },
    });

    if (existing) {
      throw new ApiError('conflict', 'An account with that email already exists.');
    }

    const passwordHash = await hashPassword(data.password);
    const user = await prisma.user.create({
      data: {
        email,
        displayName: data.displayName?.trim() || null,
        passwordHash,
        role: 'READER',
        status: 'ACTIVE',
      },
    });

    const token = await issueVerificationToken(user.id, 'EMAIL_VERIFICATION');
    if (user.email) {
      await sendEmail(verificationEmail(user.email, `${env.APP_URL}/verify-email?token=${token}`));
    }

    const tokens = await createSession(user, { ip, userAgent: req.headers['user-agent'] });
    setAuthCookies(res, tokens);

    res.status(201).json({ user: toPublicUser(user) });
  })
);

// POST /api/auth/login
authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const ip = clientIp(req);
    const { email, password, adminOnly } = loginSchema.parse(req.body);

    await consumeRateLimit(RULES.login, ip);
    await consumeRateLimit(RULES.login, email);

    const rawIdentifier = email.trim().toLowerCase();
    const searchEmail = rawIdentifier === 'admin' ? 'admin@skyupnews.com' : rawIdentifier;

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: searchEmail },
          { email: rawIdentifier },
          ...(rawIdentifier.includes('@') ? [] : [{ email: `${rawIdentifier}@skyupnews.com` }]),
        ],
      },
    });

    if (!user?.passwordHash) {
      await fakeVerify();
      throw new ApiError('invalid_credentials', 'Email or password is incorrect.');
    }

    const isValid = await verifyPassword(user.passwordHash, password);
    if (!isValid) {
      throw new ApiError('invalid_credentials', 'Email or password is incorrect.');
    }

    if (user.status !== 'ACTIVE') {
      throw new ApiError('forbidden', 'This account has been suspended.');
    }

    if (adminOnly && user.role !== 'ADMIN') {
      throw new ApiError(
        'forbidden',
        'Audience customer accounts cannot sign in to this internal management software. Please sign in to the audience news project at https://skyupnews.com.'
      );
    }

    const tokens = await createSession(user, { ip, userAgent: req.headers['user-agent'] });
    setAuthCookies(res, tokens);

    res.json({ user: toPublicUser(user) });
  })
);

// POST /api/auth/logout
authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const rawToken = req.cookies?.[REFRESH_COOKIE];
    if (rawToken) {
      await revokeSessionByToken(rawToken);
    }
    clearAuthCookies(res);
    res.json({ ok: true });
  })
);

// POST /api/auth/refresh
authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const ip = clientIp(req);
    const rawToken = req.cookies?.[REFRESH_COOKIE];
    if (!rawToken) {
      throw new ApiError('unauthorized', 'Missing refresh token.');
    }

    const tokens = await rotateSession(rawToken, { ip, userAgent: req.headers['user-agent'] });
    setAuthCookies(res, tokens);
    res.json({ ok: true, accessTokenExpiresIn: tokens.accessTokenExpiresIn });
  })
);

// GET /api/auth/me
authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const user = await getUserFromRequest(req);
    if (!user) {
      res.status(401).json({ user: null });
      return;
    }
    res.json({ user });
  })
);

// POST /api/auth/verify-email
authRouter.post(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const { token } = verifyEmailSchema.parse(req.body);
    const userId = await consumeVerificationToken(token, 'EMAIL_VERIFICATION');
    if (!userId) {
      throw new ApiError('invalid_request', 'Invalid or expired verification link.');
    }

    await prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });

    res.json({ ok: true });
  })
);

// POST /api/auth/password/forgot
authRouter.post(
  '/password/forgot',
  asyncHandler(async (req, res) => {
    const { email } = forgotPasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (user && user.status === 'ACTIVE' && user.email) {
      const token = await issueVerificationToken(user.id, 'PASSWORD_RESET');
      await sendEmail(passwordResetEmail(user.email, `${env.APP_URL}/reset-password?token=${token}`));
    }

    res.json({ ok: true });
  })
);

// POST /api/auth/password/reset
authRouter.post(
  '/password/reset',
  asyncHandler(async (req, res) => {
    const { token, password: newPassword } = resetPasswordSchema.parse(req.body);
    const userId = await consumeVerificationToken(token, 'PASSWORD_RESET');
    if (!userId) {
      throw new ApiError('invalid_request', 'Invalid or expired reset link.');
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    res.json({ ok: true });
  })
);

// POST /api/auth/otp/request
authRouter.post(
  '/otp/request',
  asyncHandler(async (req, res) => {
    const { phone } = otpRequestSchema.parse(req.body);
    await issueOtp(phone, 'PHONE_LOGIN');
    res.json({ ok: true });
  })
);

// POST /api/auth/otp/verify
authRouter.post(
  '/otp/verify',
  asyncHandler(async (req, res) => {
    const ip = clientIp(req);
    const { phone, code } = otpVerifySchema.parse(req.body);

    await verifyOtp(phone, 'PHONE_LOGIN', code);

    let user = await prisma.user.findFirst({ where: { phone } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          phone,
          phoneVerifiedAt: new Date(),
          role: 'READER',
          status: 'ACTIVE',
        },
      });
    }

    const tokens = await createSession(user, { ip, userAgent: req.headers['user-agent'] });
    setAuthCookies(res, tokens);

    res.json({ user: toPublicUser(user) });
  })
);
