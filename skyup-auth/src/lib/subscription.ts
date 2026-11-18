import { prisma } from './db';
import type {
  BillingPeriod,
  Prisma,
  Subscription,
  SubscriptionStatus,
} from '@/generated/prisma';

export interface Entitlement {
  isPremium: boolean;
  planKey: string | null;
  status: SubscriptionStatus;
  period: BillingPeriod | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** Null when there is no active period. */
  daysRemaining: number | null;
}

const FREE: Entitlement = {
  isPremium: false,
  planKey: null,
  status: 'NONE',
  period: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  daysRemaining: null,
};

export function monthsFor(period: BillingPeriod): number {
  return period === 'ANNUAL' ? 12 : 1;
}

export function addMonths(from: Date, months: number): Date {
  const next = new Date(from);
  next.setMonth(next.getMonth() + months);
  return next;
}

/**
 * Entitlement is always DERIVED from stored status plus the period end — never
 * stored as a boolean flag. A lapsed subscription therefore stops granting
 * access the moment its period ends, with no cron job required to flip a bit.
 */
export function entitlementFrom(subscription: Subscription | null): Entitlement {
  if (!subscription) return FREE;

  const now = new Date();
  const end = subscription.currentPeriodEnd;
  const withinPeriod = end !== null && end > now;
  const statusGrants =
    subscription.status === 'ACTIVE' || subscription.status === 'TRIALING';

  return {
    isPremium: statusGrants && withinPeriod,
    planKey: subscription.planKey,
    status: subscription.status,
    period: subscription.period,
    currentPeriodEnd: end,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    daysRemaining:
      withinPeriod && end
        ? Math.ceil((end.getTime() - now.getTime()) / 86_400_000)
        : null,
  };
}

export async function getEntitlement(userId: string): Promise<Entitlement> {
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  return entitlementFrom(subscription);
}

/**
 * Activates or extends Premium after a confirmed payment.
 *
 * Renewals extend from the existing period end rather than from "now", so a
 * reader who renews early does not lose the days they already paid for.
 */
export async function activatePremium(input: {
  userId: string;
  period: BillingPeriod;
  planKey?: string;
  providerSubscriptionId?: string | null;
}): Promise<Subscription> {
  const existing = await prisma.subscription.findUnique({
    where: { userId: input.userId },
  });

  const now = new Date();
  const base =
    existing?.currentPeriodEnd && existing.currentPeriodEnd > now
      ? existing.currentPeriodEnd
      : now;

  const currentPeriodEnd = addMonths(base, monthsFor(input.period));
  const planKey = input.planKey ?? 'premium';

  return prisma.subscription.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      planKey,
      status: 'ACTIVE',
      period: input.period,
      currentPeriodStart: now,
      currentPeriodEnd,
      providerSubscriptionId: input.providerSubscriptionId ?? null,
    },
    update: {
      planKey,
      status: 'ACTIVE',
      period: input.period,
      currentPeriodStart: existing?.currentPeriodStart ?? now,
      currentPeriodEnd,
      // A successful payment clears any pending cancellation.
      cancelAtPeriodEnd: false,
      canceledAt: null,
      ...(input.providerSubscriptionId
        ? { providerSubscriptionId: input.providerSubscriptionId }
        : {}),
    },
  });
}

/**
 * Cancels at period end by default — the reader keeps what they paid for.
 * `immediate` is for refunds and staff action.
 */
export async function cancelPremium(
  userId: string,
  options: { immediate?: boolean } = {},
): Promise<Subscription | null> {
  const existing = await prisma.subscription.findUnique({ where: { userId } });
  if (!existing) return null;

  if (options.immediate) {
    return prisma.subscription.update({
      where: { userId },
      data: {
        status: 'CANCELED',
        cancelAtPeriodEnd: false,
        canceledAt: new Date(),
        currentPeriodEnd: new Date(),
      },
    });
  }

  return prisma.subscription.update({
    where: { userId },
    data: { cancelAtPeriodEnd: true, canceledAt: new Date() },
  });
}

/** Resumes a subscription that was flagged to cancel but has not lapsed yet. */
export async function resumePremium(userId: string): Promise<Subscription | null> {
  const existing = await prisma.subscription.findUnique({ where: { userId } });
  if (!existing || !existing.cancelAtPeriodEnd) return existing;

  return prisma.subscription.update({
    where: { userId },
    data: { cancelAtPeriodEnd: false, canceledAt: null },
  });
}

/** Staff-granted complimentary access, recorded with who granted it and why. */
export async function grantPremium(input: {
  userId: string;
  period: BillingPeriod;
  grantedByUserId: string;
  note?: string;
}): Promise<Subscription> {
  const subscription = await activatePremium({
    userId: input.userId,
    period: input.period,
  });

  return prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      grantedByUserId: input.grantedByUserId,
      grantNote: input.note ?? null,
    },
  });
}

/**
 * "Currently paying" as a query predicate, mirroring `entitlementFrom`.
 *
 * Status alone is not enough: a lapsed row keeps its ACTIVE status until
 * something touches it, so the period end has to be checked too. Shared so the
 * audience and moderation views cannot drift apart on what "paid" means.
 */
export function premiumSubscriptionWhere(now: Date): Prisma.SubscriptionWhereInput {
  return {
    status: { in: ['ACTIVE', 'TRIALING'] },
    currentPeriodEnd: { gt: now },
  };
}
