import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/current-user';
import { ApiError, handleRoute, parseJson } from '@/lib/http';
import { verifyPaymentSignature } from '@/lib/razorpay';
import { activatePremium, getEntitlement } from '@/lib/subscription';
import { confirmPaymentSchema } from '@/lib/validation';

/**
 * Called by the browser when the checkout widget succeeds. It makes access
 * feel instant, but it is not the source of truth — the signed webhook is,
 * and it applies the same activation idempotently if this call never happens.
 */
export const POST = handleRoute(async (request: Request) => {
  const user = await requireUser(request);
  const body = await parseJson(request, confirmPaymentSchema);

  const invoice = await prisma.invoice.findUnique({
    where: { providerOrderId: body.razorpay_order_id },
  });

  if (!invoice || invoice.userId !== user.id) {
    throw new ApiError('not_found', 'That payment does not belong to your account.');
  }

  if (
    !verifyPaymentSignature({
      orderId: body.razorpay_order_id,
      paymentId: body.razorpay_payment_id,
      signature: body.razorpay_signature,
    })
  ) {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'FAILED', failureReason: 'signature_mismatch' },
    });
    throw new ApiError('invalid_request', 'Payment verification failed.');
  }

  // Already applied by the webhook — report success without extending twice.
  if (invoice.status === 'PAID') {
    return NextResponse.json({
      ok: true,
      alreadyApplied: true,
      entitlement: await getEntitlement(user.id),
    });
  }

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      status: 'PAID',
      providerPaymentId: body.razorpay_payment_id,
      paidAt: new Date(),
      paymentMethod: 'Razorpay',
    },
  });

  await activatePremium({ userId: user.id, period: invoice.period });

  return NextResponse.json({
    ok: true,
    alreadyApplied: false,
    entitlement: await getEntitlement(user.id),
  });
});
