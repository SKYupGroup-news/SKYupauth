import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/current-user';
import { handleRoute } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Everything held about the signed-in reader, as one downloadable file.
 *
 * India's DPDP Act gives a person the right to a copy of their own data; this
 * is that right implemented rather than described. Deliberately self-service:
 * a request that needs staff to fulfil it will not be fulfilled at scale.
 *
 * Secrets are excluded on purpose — password hashes, refresh-token hashes and
 * OTP hashes say nothing useful to the reader and would be dangerous in a file
 * that ends up in their downloads folder.
 */
export const GET = handleRoute(async (request: Request) => {
  const user = await requireUser(request);

  const [record, sessions, comments, articleLikes, commentLikes, notifications, invoices, subscription, oauth] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      prisma.session.findMany({
        where: { userId: user.id },
        select: { createdAt: true, expiresAt: true, revokedAt: true, userAgent: true, ip: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.comment.findMany({
        where: { userId: user.id },
        select: {
          articleId: true, articleTitle: true, articleLocation: true,
          body: true, parentId: true, createdAt: true, deletedAt: true,
          likeCount: true, replyCount: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.articleLike.findMany({
        where: { userId: user.id },
        select: { articleId: true, articleTitle: true, createdAt: true },
      }),
      prisma.commentLike.findMany({
        where: { userId: user.id },
        select: { commentId: true, createdAt: true },
      }),
      prisma.notification.findMany({
        where: { userId: user.id },
        select: { type: true, articleTitle: true, preview: true, readAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.invoice.findMany({
        where: { userId: user.id },
        select: {
          amount: true, currency: true, status: true, period: true,
          promoCode: true, paymentMethod: true, issuedAt: true, paidAt: true,
        },
        orderBy: { issuedAt: 'desc' },
      }),
      prisma.subscription.findUnique({
        where: { userId: user.id },
        select: {
          planKey: true, status: true, period: true, currentPeriodStart: true,
          currentPeriodEnd: true, cancelAtPeriodEnd: true, canceledAt: true, createdAt: true,
        },
      }),
      prisma.oAuthAccount.findMany({
        where: { userId: user.id },
        select: { provider: true, createdAt: true },
      }),
    ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    notice:
      'Everything SkyUp News holds about your account. Credentials are excluded: password, ' +
      'refresh-token and one-time-code hashes are never included in an export.',
    profile: {
      id: record.id,
      email: record.email,
      emailVerified: record.emailVerifiedAt !== null,
      phone: record.phone,
      phoneVerified: record.phoneVerifiedAt !== null,
      contactPhone: record.contactPhone,
      displayName: record.displayName,
      bio: record.bio,
      dateOfBirth: record.dateOfBirth,
      country: record.country,
      city: record.city,
      locale: record.locale,
      timezone: record.timezone,
      preferredTopics: record.preferredTopics,
      digestFrequency: record.digestFrequency,
      notifications: {
        breakingNews: record.notifyBreakingNews,
        newsletter: record.notifyNewsletter,
        productNews: record.notifyProductNews,
      },
      role: record.role,
      status: record.status,
      joinedAt: record.createdAt,
    },
    subscription,
    invoices: invoices.map((invoice) => ({ ...invoice, amount: invoice.amount / 100 })),
    comments,
    likes: { articles: articleLikes, comments: commentLikes },
    notifications,
    signIns: { sessions, linkedProviders: oauth },
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="skyup-news-data-${user.id}.json"`,
      'Cache-Control': 'no-store',
    },
  });
});
