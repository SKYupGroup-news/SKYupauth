import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  activatePremium,
  cancelPremium,
  entitlementFrom,
  getEntitlement,
  grantPremium,
  resumePremium,
} from '@/lib/subscription';
import { makeUser, resetDatabase } from './helpers';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('entitlement is derived, never stored', () => {
  it('grants access while the period is live', async () => {
    const user = await makeUser();
    await activatePremium({ userId: user.id, period: 'ANNUAL' });

    const entitlement = await getEntitlement(user.id);
    expect(entitlement.isPremium).toBe(true);
    expect(entitlement.period).toBe('ANNUAL');
  });

  it('LAPSES on its own once the period ends, with no job to flip a flag', async () => {
    const user = await makeUser();
    await activatePremium({ userId: user.id, period: 'MONTHLY' });

    // Status stays ACTIVE — only the period end moves into the past.
    await prisma.subscription.update({
      where: { userId: user.id },
      data: { currentPeriodEnd: new Date(Date.now() - 1000) },
    });

    const entitlement = await getEntitlement(user.id);
    expect(entitlement.status).toBe('ACTIVE');
    expect(entitlement.isPremium).toBe(false);
  });

  it('treats a reader with no subscription as free', async () => {
    const user = await makeUser();
    const entitlement = await getEntitlement(user.id);
    expect(entitlement.isPremium).toBe(false);
    expect(entitlement.status).toBe('NONE');
  });

  it('keeps access after cancelling until the period actually ends', async () => {
    const user = await makeUser();
    await activatePremium({ userId: user.id, period: 'ANNUAL' });
    const subscription = await cancelPremium(user.id);

    expect(subscription?.cancelAtPeriodEnd).toBe(true);
    expect(entitlementFrom(subscription).isPremium).toBe(true);
  });

  it('ends access immediately when cancelled immediately (a refund)', async () => {
    const user = await makeUser();
    await activatePremium({ userId: user.id, period: 'ANNUAL' });
    const subscription = await cancelPremium(user.id, { immediate: true });

    expect(entitlementFrom(subscription).isPremium).toBe(false);
  });

  it('resuming clears a pending cancellation', async () => {
    const user = await makeUser();
    await activatePremium({ userId: user.id, period: 'ANNUAL' });
    await cancelPremium(user.id);
    const resumed = await resumePremium(user.id);

    expect(resumed?.cancelAtPeriodEnd).toBe(false);
    expect(resumed?.canceledAt).toBeNull();
  });

  it('RENEWAL extends from the existing end, not from today', async () => {
    const user = await makeUser();
    const first = await activatePremium({ userId: user.id, period: 'MONTHLY' });
    const firstEnd = first.currentPeriodEnd!;

    // Renewing early must not forfeit the days already paid for.
    const second = await activatePremium({ userId: user.id, period: 'MONTHLY' });
    expect(second.currentPeriodEnd!.getTime()).toBeGreaterThan(firstEnd.getTime());
  });

  it('records who granted complimentary access and why', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const reader = await makeUser();

    const subscription = await grantPremium({
      userId: reader.id,
      period: 'ANNUAL',
      grantedByUserId: admin.id,
      note: 'Press account',
    });

    expect(subscription.grantedByUserId).toBe(admin.id);
    expect(subscription.grantNote).toBe('Press account');
    expect(entitlementFrom(subscription).isPremium).toBe(true);
  });
});
