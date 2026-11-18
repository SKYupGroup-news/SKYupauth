import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const NAMES = [
  'Priya Nair', 'Rohan Mehta', 'Sara Khan', 'Daniel Osei', 'Mei Lin',
  'Tomas Vega', 'Aisha Bello', 'Nikhil Rao', 'Clara Duarte', 'Yuki Tanaka',
  'Omar Haddad', 'Ines Moreau',
];

function daysFromNow(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

async function main() {
  for (let i = 0; i < NAMES.length; i += 1) {
    const name = NAMES[i]!;
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`;

    const joined = new Date();
    joined.setDate(joined.getDate() - (i * 9 + 3));

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        displayName: name,
        passwordHash: null,
        emailVerifiedAt: i % 4 === 0 ? null : new Date(),
        createdAt: joined,
        preferredTopics: ['World', 'Business'].slice(0, (i % 2) + 1),
        status: i === 11 ? 'SUSPENDED' : 'ACTIVE',
      },
    });

    // A spread of billing states so every filter has something to show.
    if (i % 3 === 0 && i !== 11) {
      const annual = i % 2 === 0;
      await prisma.subscription.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          userId: user.id,
          planKey: 'premium',
          status: 'ACTIVE',
          period: annual ? 'ANNUAL' : 'MONTHLY',
          currentPeriodStart: joined,
          currentPeriodEnd: daysFromNow(annual ? 300 : 18),
          cancelAtPeriodEnd: i === 6,
          canceledAt: i === 6 ? new Date() : null,
        },
      });

      await prisma.invoice.create({
        data: {
          userId: user.id,
          amount: annual ? 8999 : 999,
          originalAmount: annual ? 8999 : 999,
          currency: 'USD',
          status: 'PAID',
          period: annual ? 'ANNUAL' : 'MONTHLY',
          paymentMethod: 'Razorpay',
          paidAt: joined,
          issuedAt: joined,
          providerOrderId: `demo_order_${user.id}`,
        },
      });
    } else if (i === 5) {
      // Lapsed: status still ACTIVE, but the period ended — proves entitlement
      // is derived rather than stored.
      await prisma.subscription.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          userId: user.id,
          planKey: 'premium',
          status: 'ACTIVE',
          period: 'MONTHLY',
          currentPeriodStart: joined,
          currentPeriodEnd: daysFromNow(-12),
        },
      });
    }
  }

  const total = await prisma.user.count();
  console.info(`demo audience ready — ${total} users total`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
