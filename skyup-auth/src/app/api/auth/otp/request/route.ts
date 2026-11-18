import { NextResponse } from 'next/server';
import { clientIp, handleRoute, parseJson } from '@/lib/http';
import { issueOtp } from '@/lib/otp';
import { RULES, consumeRateLimit } from '@/lib/rate-limit';
import { otpRequestSchema } from '@/lib/validation';

export const POST = handleRoute(async (request: Request) => {
  const { phone } = await parseJson(request, otpRequestSchema);

  // Per-phone limit protects the number's owner from SMS bombing; per-IP limit
  // caps the cost an attacker can run up across many numbers.
  await consumeRateLimit(RULES.otpSend, phone);
  await consumeRateLimit(RULES.otpSend, clientIp(request));

  await issueOtp(phone, 'PHONE_LOGIN');

  return NextResponse.json({
    ok: true,
    message: 'If that number can receive SMS, a code is on its way.',
    expiresInSeconds: 300,
  });
});
