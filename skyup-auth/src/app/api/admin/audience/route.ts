import { NextResponse } from 'next/server';
import { replica } from '@/lib/db';
import { requireUser } from '@/lib/current-user';
import { ApiError, handleRoute } from '@/lib/http';
import { entitlementFrom, premiumSubscriptionWhere } from '@/lib/subscription';
import { avatarSrcFor } from '@/lib/current-user';
import type { Prisma } from '@/generated/prisma';

export const AUDIENCE_FILTERS = [
  'all',
  'premium',
  'free',
  'cancelling',
  'expiring',
] as const;

export type AudienceFilter = (typeof AUDIENCE_FILTERS)[number];

const PAGE_SIZE = 25;

/** Sentinel for readers with no location on their profile. */
export const NO_LOCATION = '__none__';

/** Shared with the moderation view so "paid" means the same thing in both. */
const premiumWhere = premiumSubscriptionWhere;

/**
 * Last instant of the month `now` falls in, in the server's timezone.
 *
 * The server's zone, not UTC, because "this month" is a calendar question asked
 * by staff in their own timezone — and because the UI renders these dates in
 * that same zone. Under UTC the two disagree at the edges: a period ending
 * 30 Sep 23:00 UTC displays as 1 Oct in IST, so a UTC window produces a list
 * headed "expiring this month" containing rows dated next month.
 *
 * The resulting Date is still an absolute instant, so the comparison against
 * stored UTC timestamps is correct. Day 0 of the following month is the last
 * day of this one, which sidesteps month lengths and leap years.
 */
export function endOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
}

/**
 * Subscriptions that still grant access but run out before the month is over.
 *
 * Bounded at both ends on purpose: `gt: now` keeps out anyone who has already
 * lapsed (they belong in "not paid"), and the upper bound keeps the list to
 * what needs attention before the month closes.
 */
function expiringWhere(now: Date): Prisma.SubscriptionWhereInput {
  return {
    ...premiumWhere(now),
    currentPeriodEnd: { gt: now, lte: endOfMonth(now) },
  };
}

function filterToWhere(filter: AudienceFilter, now: Date): Prisma.UserWhereInput {
  switch (filter) {
    case 'premium':
      return { subscription: { is: premiumWhere(now) } };
    case 'cancelling':
      return { subscription: { is: { ...premiumWhere(now), cancelAtPeriodEnd: true } } };
    case 'expiring':
      return { subscription: { is: expiringWhere(now) } };
    case 'free':
      // Either no subscription row at all, or one that no longer grants access.
      return { NOT: { subscription: { is: premiumWhere(now) } } };
    default:
      return {};
  }
}

export const GET = handleRoute(async (request: Request) => {
  const actor = await requireUser(request);
  if (actor.role !== 'ADMIN') {
    throw new ApiError('forbidden', 'Only administrators can view the audience.');
  }

  const url = new URL(request.url);
  const query = url.searchParams.get('q')?.trim() ?? '';
  // Derived from the type rather than a hand-kept list: the two drifted apart
  // once before, and an unknown filter silently fell back to "all".
  const filterParam = url.searchParams.get('filter') ?? 'all';
  const filter: AudienceFilter = (AUDIENCE_FILTERS as readonly string[]).includes(filterParam)
    ? (filterParam as AudienceFilter)
    : 'all';
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);

  // Location comes from the reader's own profile (Country / Region, State / Province, City).
  const country = url.searchParams.get('country')?.trim() || '';
  const state = url.searchParams.get('state')?.trim() || '';
  const city = url.searchParams.get('city')?.trim() || '';

  const now = new Date();

  const search: Prisma.UserWhereInput = query
    ? {
        OR: [
          { email: { contains: query, mode: 'insensitive' } },
          { displayName: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query } },
          { city: { contains: query, mode: 'insensitive' } },
          { state: { contains: query, mode: 'insensitive' } },
          { country: { contains: query, mode: 'insensitive' } },
        ],
      }
    : {};

  // "(none)" is the sentinel for readers who have not filled in a location.
  const locationWhere: Prisma.UserWhereInput = {
    ...(country ? (country === NO_LOCATION ? { country: null } : { country }) : {}),
    ...(state ? (state === NO_LOCATION ? { state: null } : { state }) : {}),
    ...(city ? (city === NO_LOCATION ? { city: null } : { city }) : {}),
  };

  const where: Prisma.UserWhereInput = {
    AND: [search, filterToWhere(filter, now), locationWhere],
  };

  // Facets ignore the location filter itself, so changing region never leaves
  // the dropdowns empty — but they do respect the search and status filters.
  const facetWhere: Prisma.UserWhereInput = { AND: [search, filterToWhere(filter, now)] };

  const [
      total,
      rows,
      totalReaders,
      premiumCount,
      cancellingCount,
      expiringCount,
      paidAgg,
      locationRows,
    ] =
    await Promise.all([
      replica.user.count({ where }),
      replica.user.findMany({
        where,
        include: { subscription: true },
        // A renewal list is read soonest-first; everything else is newest-first.
        orderBy:
          filter === 'expiring'
            ? { subscription: { currentPeriodEnd: 'asc' } }
            : { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      replica.user.count(),
      replica.user.count({ where: { subscription: { is: premiumWhere(now) } } }),
      replica.user.count({
        where: { subscription: { is: { ...premiumWhere(now), cancelAtPeriodEnd: true } } },
      }),
      replica.user.count({ where: { subscription: { is: expiringWhere(now) } } }),
      // Grouped by currency: summing minor units across currencies would be
      // meaningless if INR and USD invoices ever coexist.
      replica.invoice.groupBy({
        by: ['currency'],
        _sum: { amount: true },
        where: { status: 'PAID' },
      }),
      // One grouped pass gives every country/state/city tuple and its size.
      replica.user.groupBy({
        by: ['country', 'state', 'city'],
        where: facetWhere,
        _count: { _all: true },
      }),
    ]);

  // Fold the tuples into regions (countries), each carrying its states and cities.
  const regionMap = new Map<
    string,
    {
      value: string;
      label: string;
      count: number;
      states: Map<string, { value: string; label: string; count: number; cities: Map<string, number> }>;
      cities: Map<string, number>;
    }
  >();

  for (const row of locationRows) {
    const value = row.country ?? NO_LOCATION;
    const label = row.country ?? 'No location set';
    const entry =
      regionMap.get(value) ?? {
        value,
        label,
        count: 0,
        states: new Map(),
        cities: new Map(),
      };

    entry.count += row._count._all;

    const stateValue = row.state ?? NO_LOCATION;
    const stateLabel = row.state ?? 'No state set';
    const stateEntry = entry.states.get(stateValue) ?? {
      value: stateValue,
      label: stateLabel,
      count: 0,
      cities: new Map(),
    };
    stateEntry.count += row._count._all;

    const cityValue = row.city ?? NO_LOCATION;
    stateEntry.cities.set(cityValue, (stateEntry.cities.get(cityValue) ?? 0) + row._count._all);
    entry.states.set(stateValue, stateEntry);

    entry.cities.set(cityValue, (entry.cities.get(cityValue) ?? 0) + row._count._all);
    regionMap.set(value, entry);
  }

  const regions = [...regionMap.values()]
    // Real places first and biggest first; "No location set" always last.
    .sort((a, b) =>
      a.value === NO_LOCATION ? 1 : b.value === NO_LOCATION ? -1 : b.count - a.count,
    )
    .map((entry) => ({
      value: entry.value,
      label: entry.label,
      count: entry.count,
      states: [...entry.states.values()]
        .map((s) => ({
          value: s.value,
          label: s.label,
          count: s.count,
          cities: [...s.cities.entries()]
            .map(([cVal, cCount]) => ({
              value: cVal,
              label: cVal === NO_LOCATION ? 'No city set' : cVal,
              count: cCount,
            }))
            .sort((a, b) =>
              a.value === NO_LOCATION ? 1 : b.value === NO_LOCATION ? -1 : b.count - a.count,
            ),
        }))
        .sort((a, b) =>
          a.value === NO_LOCATION ? 1 : b.value === NO_LOCATION ? -1 : b.count - a.count,
        ),
      cities: [...entry.cities.entries()]
        .map(([val, count]) => ({
          value: val,
          label: val === NO_LOCATION ? 'No city set' : val,
          count,
        }))
        .sort((a, b) =>
          a.value === NO_LOCATION ? 1 : b.value === NO_LOCATION ? -1 : b.count - a.count,
        ),
    }));

  return NextResponse.json({
    summary: {
      totalReaders,
      premium: premiumCount,
      free: totalReaders - premiumCount,
      cancelling: cancellingCount,
      expiringThisMonth: expiringCount,
      /// So the UI can name the period without re-deriving it.
      monthEndsOn: endOfMonth(now),
      collected: paidAgg.map((row) => ({
        currency: row.currency,
        amountMinor: row._sum.amount ?? 0,
      })),
    },
    page,
    pageSize: PAGE_SIZE,
    regions,
    activeLocation: { country, state, city },
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    readers: rows.map((user) => {
      const entitlement = entitlementFrom(user.subscription);
      return {
        id: user.id,
        name: user.displayName,
        email: user.email,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        avatarSrc: avatarSrcFor(user),
        country: user.country,
        state: user.state,
        city: user.city,
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerifiedAt !== null,
        phoneVerified: user.phoneVerifiedAt !== null,
        joinedAt: user.createdAt,
        isPremium: entitlement.isPremium,
        plan: entitlement.isPremium ? entitlement.period : null,
        subscriptionStatus: entitlement.status,
        currentPeriodEnd: entitlement.currentPeriodEnd,
        cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
        daysRemaining: entitlement.daysRemaining,
        isComplimentary: Boolean(user.subscription?.grantedByUserId),
      };
    }),
  });
});
