import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/current-user';
import { handleRoute, parseJson } from '@/lib/http';
import { priceFor } from '@/lib/plans';
import { createOrder, publishableKey } from '@/lib/razorpay';
import { checkoutSchema } from '@/lib/validation';

export const POST = handleRoute(async (request: Request) => {
  const user = await requireUser(request);
  const { period, promoCode } = await parseJson(request, checkoutSchema);

  // Price is resolved server-side from the catalog. Nothing about the amount
  // or the discount is taken from the request body.
  const pricing = await priceFor(period, promoCode);

  const invoice = await prisma.invoice.create({
    data: {
      userId: user.id,
      amount: pricing.amountMinor,
      originalAmount: pricing.originalMinor,
      currency: pricing.currency,
      status: 'PENDING',
      period,
      promoCode: pricing.promoCode,
      discountPercent: pricing.discountPercent,
    },
  });

  const order = await createOrder({
    amountMinor: pricing.amountMinor,
    currency: pricing.currency,
    receipt: invoice.id,
    notes: { userId: user.id, invoiceId: invoice.id, period },
  });

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { providerOrderId: order.id },
  });

  return NextResponse.json({
    invoiceId: invoice.id,
    orderId: order.id,
    amount: pricing.amountMinor,
    amountFormatted: (pricing.amountMinor / 100).toFixed(2),
    currency: pricing.currency,
    discountPercent: pricing.discountPercent,
    promoCode: pricing.promoCode,
    keyId: publishableKey(),
    prefill: {
      name: user.displayName ?? '',
      email: user.email ?? '',
      contact: user.phone ?? '',
    },
  });
});
