import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env';
import { ApiError } from './http';

const API = 'https://api.razorpay.com/v1';

export function isRazorpayConfigured(): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

function credentials(): { keyId: string; keySecret: string } {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new ApiError(
      'provider_not_configured',
      'Online payment is not configured on this server.',
    );
  }
  return { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET };
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

/**
 * Creates the order the browser checkout widget opens against.
 *
 * `receipt` carries our own invoice id so a webhook can be traced back to the
 * row it belongs to even if the client never returns from the payment page.
 */
export async function createOrder(input: {
  amountMinor: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  const { keyId, keySecret } = credentials();

  const response = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes ?? {},
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error('[billing] razorpay order creation failed:', detail);
    throw new ApiError('internal_error', 'Could not start checkout. Please try again.');
  }

  return (await response.json()) as RazorpayOrder;
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifies the handoff the checkout widget posts back to us.
 * Razorpay signs `order_id|payment_id` with the API key secret.
 */
export function verifyPaymentSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const { keySecret } = credentials();
  const expected = createHmac('sha256', keySecret)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest('hex');
  return safeEqualHex(expected, input.signature);
}

/**
 * Verifies a webhook delivery. The signature covers the RAW body, so the caller
 * must pass the exact bytes received — re-serialising parsed JSON changes key
 * order and whitespace and would fail verification.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  // Returns false rather than throwing when unconfigured: this endpoint is
  // public, and a distinct "not configured" reply would tell an unauthenticated
  // caller about our deployment state.
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    console.error('[billing] webhook received but RAZORPAY_WEBHOOK_SECRET is unset.');
    return false;
  }
  const expected = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return safeEqualHex(expected, signature);
}

export function publishableKey(): string {
  return credentials().keyId;
}
