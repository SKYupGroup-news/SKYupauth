import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleRoute, parseJson } from '@/lib/http';
import { getCurrentUser } from '@/lib/current-user';
import { subscribeNewsletterSchema } from '@/lib/validation';

export const POST = handleRoute(async (request: Request) => {
  const { email } = await parseJson(request, subscribeNewsletterSchema);

  const currentUser = await getCurrentUser(request);

  const subscriber = await prisma.newsletterSubscriber.upsert({
    where: { email },
    create: {
      email,
      active: true,
      userId: currentUser?.id ?? null,
    },
    update: {
      active: true,
      ...(currentUser?.id ? { userId: currentUser.id } : {}),
    },
  });

  // If there's an existing user row with this email, keep notifyNewsletter enabled
  await prisma.user.updateMany({
    where: { email },
    data: { notifyNewsletter: true },
  });

  return NextResponse.json({
    success: true,
    message: 'Subscribed to SKYup Morning Briefing!',
    subscriber: {
      id: subscriber.id,
      email: subscriber.email,
      active: subscriber.active,
      createdAt: subscriber.createdAt,
    },
  });
});

export const GET = handleRoute(async (request: Request) => {
  const url = new URL(request.url);
  const email = url.searchParams.get('email')?.trim().toLowerCase();

  if (email) {
    const subscriber = await prisma.newsletterSubscriber.findUnique({
      where: { email },
    });
    return NextResponse.json({
      subscribed: Boolean(subscriber?.active),
      subscriber: subscriber ?? null,
    });
  }

  const count = await prisma.newsletterSubscriber.count({ where: { active: true } });
  const subscribers = await prisma.newsletterSubscriber.findMany({
    take: 50,
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({
    totalSubscribers: count,
    subscribers: subscribers.map((s) => ({
      id: s.id,
      email: s.email,
      active: s.active,
      createdAt: s.createdAt,
    })),
  });
});
