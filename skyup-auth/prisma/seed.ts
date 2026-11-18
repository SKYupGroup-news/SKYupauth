import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

// Relative imports (not the "@/" alias) so this runs standalone under tsx.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@skyupnews.com';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'PriyaGa@#1121';

async function main() {
  const passwordHash = await hash(ADMIN_PASSWORD, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { role: 'ADMIN', passwordHash },
    create: {
      email: ADMIN_EMAIL,
      passwordHash,
      displayName: 'SkyUp Admin',
      role: 'ADMIN',
      emailVerifiedAt: new Date(),
    },
  });

  console.info(`Seeded admin: ${admin.email}`);

  // The audience-side app ships two demo personas with a "quick login" button.
  // Seeding them here means that button exercises the real auth service instead
  // of the old localStorage store, so the app has exactly one source of identity.
  const demoHash = await hash('password123', {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const elena = await prisma.user.upsert({
    where: { email: 'elena.vance@skyupnews.org' },
    update: {
      country: 'United States',
      state: 'New York',
      city: 'New York',
    },
    create: {
      email: 'elena.vance@skyupnews.org',
      phone: '+12125550198',
      passwordHash: demoHash,
      displayName: 'Dr. Elena Vance',
      bio: 'Senior AI Researcher & Technology Editor. Exploring multi-agent intelligence and future energy grids.',
      avatarUrl:
        'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
      dateOfBirth: new Date('1992-04-15'),
      country: 'United States',
      state: 'New York',
      city: 'New York',
      preferredTopics: ['Tech', 'Science', 'World', 'Business'],
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    },
  });

  const alex = await prisma.user.upsert({
    where: { email: 'alex.morgan@skyupnews.org' },
    update: {
      country: 'United States',
      state: 'California',
      city: 'San Francisco',
    },
    create: {
      email: 'alex.morgan@skyupnews.org',
      phone: '+14155550142',
      passwordHash: demoHash,
      displayName: 'Alex Morgan',
      bio: 'Biotech enthusiast, space exploration researcher & subscriber.',
      avatarUrl:
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      dateOfBirth: new Date('1996-08-22'),
      country: 'United States',
      state: 'California',
      city: 'San Francisco',
      preferredTopics: ['Science', 'Biotech', 'Entertainment'],
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    },
  });

  const priya = await prisma.user.upsert({
    where: { email: 'priya.sharma@skyupnews.org' },
    update: {
      country: 'India',
      state: 'Maharashtra',
      city: 'Mumbai',
    },
    create: {
      email: 'priya.sharma@skyupnews.org',
      phone: '+919820011223',
      passwordHash: demoHash,
      displayName: 'Priya Sharma',
      bio: 'Financial markets and business policy analyst.',
      avatarUrl:
        'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
      dateOfBirth: new Date('1995-11-10'),
      country: 'India',
      state: 'Maharashtra',
      city: 'Mumbai',
      preferredTopics: ['Business', 'Economy', 'Markets'],
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    },
  });

  const aravind = await prisma.user.upsert({
    where: { email: 'aravind.kumar@skyupnews.org' },
    update: {
      country: 'India',
      state: 'Delhi',
      city: 'New Delhi',
    },
    create: {
      email: 'aravind.kumar@skyupnews.org',
      phone: '+919811099887',
      passwordHash: demoHash,
      displayName: 'Aravind Kumar',
      bio: 'National affairs and technology policy reader.',
      avatarUrl:
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      dateOfBirth: new Date('1993-02-18'),
      country: 'India',
      state: 'Delhi',
      city: 'New Delhi',
      preferredTopics: ['Politics', 'National', 'Tech'],
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    },
  });

  // Alex is the "already subscribed" persona in the mock data.
  const now = new Date();
  const yearEnd = new Date(now);
  yearEnd.setMonth(yearEnd.getMonth() + 12);

  await prisma.subscription.upsert({
    where: { userId: alex.id },
    update: {},
    create: {
      userId: alex.id,
      planKey: 'premium',
      status: 'ACTIVE',
      period: 'ANNUAL',
      currentPeriodStart: now,
      currentPeriodEnd: yearEnd,
      grantedByUserId: admin.id,
      grantNote: 'Demo persona seed',
    },
  });

  console.info(`Seeded demo personas: ${elena.email}, ${alex.email}, ${priya.email}, ${aravind.email}`);
  if (ADMIN_PASSWORD === 'change-me-please') {
    console.warn('WARNING: seeded with the default password. Change it before deploying.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
