import { prisma } from './db';
import { ApiError } from './http';
import { otpMessage, sendSms } from './sms';
import { constantTimeEquals, generateNumericCode, hashToken } from './tokens';
import type { OtpPurpose } from '@/generated/prisma';

const OTP_TTL_SECONDS = 300; // 5 minutes
const MAX_ATTEMPTS = 5;

/**
 * Issues a fresh code and invalidates any earlier outstanding code for the same
 * phone/purpose, so a resend cannot be used to widen the guessing window.
 */
export async function issueOtp(phone: string, purpose: OtpPurpose): Promise<void> {
  const code = generateNumericCode(6);

  await prisma.$transaction([
    prisma.otpCode.updateMany({
      where: { phone, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    }),
    prisma.otpCode.create({
      data: {
        phone,
        purpose,
        codeHash: hashToken(code),
        expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
      },
    }),
  ]);

  await sendSms(phone, otpMessage(code));
}

/**
 * Consumes a code. Every failure increments the attempt counter; once the cap
 * is reached the code is burned outright so an attacker cannot keep guessing.
 */
export async function verifyOtp(
  phone: string,
  purpose: OtpPurpose,
  code: string,
): Promise<void> {
  const record = await prisma.otpCode.findFirst({
    where: { phone, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) {
    throw new ApiError('invalid_credentials', 'That code is not valid. Request a new one.');
  }

  if (record.expiresAt <= new Date()) {
    await prisma.otpCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    throw new ApiError('invalid_credentials', 'That code has expired. Request a new one.');
  }

  if (!constantTimeEquals(record.codeHash, hashToken(code))) {
    const attempts = record.attempts + 1;
    await prisma.otpCode.update({
      where: { id: record.id },
      data: {
        attempts,
        consumedAt: attempts >= MAX_ATTEMPTS ? new Date() : null,
      },
    });
    throw new ApiError(
      'invalid_credentials',
      attempts >= MAX_ATTEMPTS
        ? 'Too many incorrect attempts. Request a new code.'
        : 'That code is not valid.',
    );
  }

  await prisma.otpCode.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });
}
