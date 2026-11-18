import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleRoute } from '@/lib/http';
import { verifyWebhookSignature } from '@/lib/razorpay';
import { activatePremium, cancelPremium } from '@/lib/subscription';
import type { BillingPeriod } from '@/generated/prisma';

interface RazorpayWebhook {
  event: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        method?: string;
        error_description?: string;
      };
    };
  };
}

/**
 * Source of truth for billing state.
 *
 * The browser confirm call is a convenience; this endpoint is what guarantees a
 * paid reader gets access even if they close the tab mid-redirect. Razorpay
 * retries deliveries, so every event id is recorded and replays are dropped.
 */
export const POST = handleRoute(async (request: Request) => {
  // The signature covers the exact bytes received, so read the body as raw text
  // and never re-serialise it before verifying.
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature');

  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    // Deliberately terse: an unverified caller learns nothing about why.
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const eventId = request.headers.get('x-razorpay-event-id');
  if (eventId) {
    const seen = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
    if (seen) return NextResponse.json({ ok: true, duplicate: true });
  }

  const body = JSON.parse(rawBody) as RazorpayWebhook;
  const payment = body.payload?.payment?.entity;
  const orderId = payment?.order_id;

  if (orderId) {
    const invoice = await prisma.invoice.findUnique({ where: { providerOrderId: orderId } });

    if (invoice) {
      if (body.event === 'payment.captured' && invoice.status !== 'PAID') {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            status: 'PAID',
            providerPaymentId: payment?.id ?? null,
            paymentMethod: payment?.method ?? 'Razorpay',
            paidAt: new Date(),
          },
        });
        // An invoice whose owner has deleted their account is retained for
        // financial records but has nobody left to grant access to.
        if (invoice.userId) {
          await activatePremium({
            userId: invoice.userId,
            period: invoice.period as BillingPeriod,
          });
        }
      }

      if (body.event === 'payment.failed' && invoice.status === 'PENDING') {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            status: 'FAILED',
            failureReason: payment?.error_description ?? 'payment_failed',
          },
        });
      }

      if (body.event === 'refund.processed') {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: 'REFUNDED' },
        });
        // A refund removes the entitlement it paid for straight away — unless
        // the account is already gone, in which case there is nothing to revoke.
        if (invoice.userId) {
          await cancelPremium(invoice.userId, { immediate: true });
        }
      }
    }
  }

  if (eventId) {
    await prisma.webhookEvent.create({
      data: { id: eventId, provider: 'razorpay', eventType: body.event },
    });
  }

  return NextResponse.json({ ok: true });
});
