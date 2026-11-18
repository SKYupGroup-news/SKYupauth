import { env } from './env';
import { ApiError } from './http';

/**
 * Shape returned by the platform's subscription-service (`GET /api/subscriptions/plan`).
 * That service remains the single source of truth for pricing, features and copy —
 * this app never stores prices, so Finance can change them without a deploy here.
 */
export interface PlanCatalog {
  id: string;
  planKey: string;
  name: string;
  currencyCode: string;
  monthlyPrice: number;
  annualPrice: number;
  originalAnnualPrice?: number;
  description?: string;
  features?: Array<{ text: string; highlight: boolean }>;
  [key: string]: unknown;
}

export interface PromoValidation {
  valid: boolean;
  discountPercent: number;
  label?: string;
  message: string;
}

// The catalog changes rarely and every checkout reads it, so a short in-process
// cache keeps us from hammering :8083 on each request.
const CACHE_TTL_MS = 30_000;
let cache: { value: PlanCatalog; at: number } | null = null;

async function serviceFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${env.SUBSCRIPTION_SERVICE_URL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new ApiError(
      'internal_error',
      'The subscription service is unavailable. Please try again shortly.',
    );
  }
}

export async function getPlanCatalog(): Promise<PlanCatalog> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const response = await serviceFetch('/api/subscriptions/plan');
  if (!response.ok) {
    throw new ApiError('internal_error', 'Could not load the current plan.');
  }

  const value = (await response.json()) as PlanCatalog;
  cache = { value, at: Date.now() };
  return value;
}

export async function validatePromoCode(code: string): Promise<PromoValidation> {
  const response = await serviceFetch('/api/subscriptions/validate-promo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    return { valid: false, discountPercent: 0, message: 'Could not validate that code.' };
  }

  return (await response.json()) as PromoValidation;
}

/**
 * Resolves the amount actually payable, in minor units.
 *
 * Prices and discounts are re-read from the catalog server-side on every
 * checkout: a client that posts its own amount or promo discount is ignored,
 * which is what stops "1 rupee Premium" attacks.
 */
export async function priceFor(
  period: 'MONTHLY' | 'ANNUAL',
  promoCode?: string | null,
): Promise<{
  amountMinor: number;
  originalMinor: number;
  currency: string;
  discountPercent: number;
  promoCode: string | null;
}> {
  const plan = await getPlanCatalog();
  const major = period === 'ANNUAL' ? plan.annualPrice : plan.monthlyPrice;
  const originalMinor = Math.round(major * 100);

  let discountPercent = 0;
  let applied: string | null = null;

  if (promoCode) {
    const promo = await validatePromoCode(promoCode);
    if (promo.valid) {
      discountPercent = promo.discountPercent;
      applied = promoCode.trim().toUpperCase();
    }
  }

  const amountMinor = Math.max(0, Math.round(originalMinor * (1 - discountPercent / 100)));

  return {
    amountMinor,
    originalMinor,
    currency: plan.currencyCode || 'INR',
    discountPercent,
    promoCode: applied,
  };
}
