import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/current-user';
import { ApiError, handleRoute } from '@/lib/http';
import { entitlementFrom } from '@/lib/subscription';
import { AUTHOR_SELECT, toPublicAuthor } from '@/lib/engagement';
import { avatarSrcFor } from '@/lib/current-user';

/** Everything staff need about one reader, in a single round trip. */
export const GET = handleRoute(
  async (request: Request, ctx: { params: Promise<{ userId: string }> }) => {
    const actor = await requireUser(request);
    if (actor.role !== 'ADMIN') {
      throw new ApiError('forbidden', 'Only administrators can view reader profiles.');
    }

    const { userId } = await ctx.params;
    const now = new Date();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscription: true,
        oauthAccounts: { select: { provider: true, createdAt: true } },
        invoices: { orderBy: { issuedAt: 'desc' }, take: 100 },
        // Sessions double as the login history: one row per sign-in.
        sessions: { orderBy: { createdAt: 'desc' }, take: 25 },
      },
    });

    if (!user) throw new ApiError('not_found', 'No such reader.');

    const entitlement = entitlementFrom(user.subscription);

    // Engagement is counted separately so the reader row itself stays light.
    const [likeCount, commentCount, likesReceived, recentComments, unreadNotifications] =
      await Promise.all([
        prisma.articleLike.count({ where: { userId } }),
        prisma.comment.count({ where: { userId, deletedAt: null } }),
        prisma.commentLike.count({ where: { comment: { userId } } }),
        prisma.comment.findMany({
          where: { userId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { _count: { select: { likes: true, replies: true } } },
        }),
        prisma.notification.count({ where: { userId, readAt: null } }),
      ]);

    // Append-only staff audit for this account, newest first.
    const accountActions = await prisma.accountAction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { actor: { select: AUTHOR_SELECT } },
    });

    const lifetimeMinor = user.invoices
      .filter((invoice) => invoice.status === 'PAID')
      .reduce((sum, invoice) => sum + invoice.amount, 0);

    return NextResponse.json({
      reader: {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerifiedAt !== null,
        phone: user.phone,
        phoneVerified: user.phoneVerifiedAt !== null,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        avatarSrc: avatarSrcFor(user),
        bio: user.bio,
        dateOfBirth: user.dateOfBirth,
        locale: user.locale,
        timezone: user.timezone,
        country: user.country,
        state: user.state,
        city: user.city,
        contactPhone: user.contactPhone,
        digestFrequency: user.digestFrequency,
        preferredTopics: user.preferredTopics,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        hasPassword: user.passwordHash !== null,
        notifications: {
          breakingNews: user.notifyBreakingNews,
          newsletter: user.notifyNewsletter,
          productNews: user.notifyProductNews,
        },
      },
      entitlement,
      subscription: user.subscription
        ? {
            planKey: user.subscription.planKey,
            status: user.subscription.status,
            period: user.subscription.period,
            currentPeriodStart: user.subscription.currentPeriodStart,
            currentPeriodEnd: user.subscription.currentPeriodEnd,
            cancelAtPeriodEnd: user.subscription.cancelAtPeriodEnd,
            canceledAt: user.subscription.canceledAt,
            // Present only on complimentary access granted by staff.
            grantedByUserId: user.subscription.grantedByUserId,
            grantNote: user.subscription.grantNote,
            createdAt: user.subscription.createdAt,
          }
        : null,
      signIns: {
        // Providers the reader can actually use to get in.
        password: user.passwordHash !== null,
        phoneOtp: user.phoneVerifiedAt !== null,
        oauth: user.oauthAccounts.map((account) => ({
          provider: account.provider,
          linkedAt: account.createdAt,
        })),
      },
      billing: {
        lifetimeValue: lifetimeMinor / 100,
        currency: user.invoices[0]?.currency ?? 'INR',
        paidCount: user.invoices.filter((invoice) => invoice.status === 'PAID').length,
        invoices: user.invoices.map((invoice) => ({
          id: invoice.id,
          amount: invoice.amount / 100,
          originalAmount: invoice.originalAmount ? invoice.originalAmount / 100 : null,
          currency: invoice.currency,
          status: invoice.status,
          period: invoice.period,
          promoCode: invoice.promoCode,
          discountPercent: invoice.discountPercent,
          paymentMethod: invoice.paymentMethod,
          failureReason: invoice.failureReason,
          issuedAt: invoice.issuedAt,
          paidAt: invoice.paidAt,
        })),
      },
      activity: user.sessions.map((session) => ({
        id: session.id,
        signedInAt: session.createdAt,
        expiresAt: session.expiresAt,
        userAgent: session.userAgent,
        ip: session.ip,
        // A session is live only if never revoked and not yet expired.
        active: session.revokedAt === null && session.expiresAt > now,
        revokedAt: session.revokedAt,
        rotatedAt: session.rotatedAt,
      })),
      accountActions: accountActions.map((entry) => ({
        id: entry.id,
        type: entry.type,
        reason: entry.reason,
        actor: toPublicAuthor(entry.actor),
        createdAt: entry.createdAt,
      })),
      engagement: {
        articleLikes: likeCount,
        comments: commentCount,
        /// Likes other readers gave this reader's comments.
        likesReceived,
        unreadNotifications,
        recentComments: recentComments.map((comment) => ({
          id: comment.id,
          articleId: comment.articleId,
          articleTitle: comment.articleTitle,
          body: comment.body,
          isReply: comment.parentId !== null,
          likeCount: comment._count.likes,
          replyCount: comment._count.replies,
          createdAt: comment.createdAt,
        })),
      },
      activeSessionCount: user.sessions.filter(
        (session) => session.revokedAt === null && session.expiresAt > now,
      ).length,
    });
  },
);
