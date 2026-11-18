import { Router } from 'express';
import { prisma } from '@/lib/db';
import { ApiError, asyncHandler } from '@/lib/http';
import { requireAuth, toPublicUser } from '@/lib/current-user';
import { updateProfileSchema, passwordSchema } from '@/lib/validation';
import { hashPassword, verifyPassword } from '@/lib/password';
import { revokeAllSessions } from '@/lib/session';
import { z } from 'zod';

export const profileRouter = Router();

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

// GET /api/profile
profileRouter.get(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [user, activeSessions, linkedAccounts] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.user!.id },
      }),
      prisma.session.count({
        where: { userId: req.user!.id, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
      prisma.oAuthAccount.findMany({
        where: { userId: req.user!.id },
        select: { provider: true },
      }),
    ]);
    if (!user) throw new ApiError('not_found', 'User not found.');
    res.json({
      user: toPublicUser(user),
      activeSessions,
      linkedAccounts: linkedAccounts.map((a) => a.provider),
    });
  })
);

// PATCH /api/profile
profileRouter.patch(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = updateProfileSchema.parse(req.body);
    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
        ...(data.bio !== undefined ? { bio: data.bio } : {}),
        ...(data.country !== undefined ? { country: data.country } : {}),
        ...(data.state !== undefined ? { state: data.state } : {}),
        ...(data.city !== undefined ? { city: data.city } : {}),
        ...(data.contactPhone !== undefined ? { contactPhone: data.contactPhone } : {}),
        ...(data.digestFrequency !== undefined ? { digestFrequency: data.digestFrequency } : {}),
        ...(data.preferredTopics !== undefined ? { preferredTopics: data.preferredTopics } : {}),
        ...(data.notifyBreakingNews !== undefined ? { notifyBreakingNews: data.notifyBreakingNews } : {}),
        ...(data.notifyNewsletter !== undefined ? { notifyNewsletter: data.notifyNewsletter } : {}),
        ...(data.notifyProductNews !== undefined ? { notifyProductNews: data.notifyProductNews } : {}),
      },
    });

    res.json({ user: toPublicUser(updated) });
  })
);

// POST /api/profile/password
profileRouter.post(
  '/profile/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
    });

    if (!user?.passwordHash) {
      throw new ApiError('invalid_credentials', 'Account does not have a local password set.');
    }

    const valid = await verifyPassword(user.passwordHash, currentPassword);
    if (!valid) {
      throw new ApiError('invalid_credentials', 'Current password is incorrect.');
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    await revokeAllSessions(user.id);
    res.json({ ok: true });
  })
);
