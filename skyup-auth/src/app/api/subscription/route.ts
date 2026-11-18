import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/current-user';
import { handleRoute } from '@/lib/http';
import { getPlanCatalog } from '@/lib/plans';
import { isRazorpayConfigured } from '@/lib/razorpay';
import { getEntitlement } from '@/lib/subscription';

export const GET = handleRoute(async (request: Request) => {
  const user = await requireUser(request);

  const [entitlement, invoices] = await Promise.all([
    getEntitlement(user.id),
    prisma.invoice.findMany({
      where: { userId: user.id },
      orderBy: { issuedAt: 'desc' },
      take: 50,
    }),
  ]);

  // The catalog lives in another service; a billing page should still render
  // the reader's own status if that service is briefly unavailable.
  let plan = null;
  try {
    plan = await getPlanCatalog();
  } catch {
    plan = null;
  }

  return NextResponse.json({
    entitlement,
    plan,
    paymentsEnabled: isRazorpayConfigured(),
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      amount: invoice.amount / 100,
      currency: invoice.currency,
      status: invoice.status,
      period: invoice.period,
      promoCode: invoice.promoCode,
      discountPercent: invoice.discountPercent,
      paymentMethod: invoice.paymentMethod,
      issuedAt: invoice.issuedAt,
      paidAt: invoice.paidAt,
    })),
  });
});
