import { prisma } from './db';
import { ApiError } from './http';
import { generateOpaqueToken, hashToken } from './tokens';
import type { VerificationPurpose } from '@/generated/prisma';

export const TTL_SECONDS: Record<VerificationPurpose, number> = {
  EMAIL_VERIFICATION: 86_400, // 24 hours
  PASSWORD_RESET: 3_600, // 1 hour
};

/** Returns the raw token — the caller emails it; only the hash is stored. */
export async function issueVerificationToken(
  userId: string,
  purpose: VerificationPurpose,
): Promise<string> {
  const token = generateOpaqueToken();

  await prisma.$transaction([
    // Supersede outstanding tokens so an old link cannot be replayed later.
    prisma.verificationToken.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    }),
    prisma.verificationToken.create({
      data: {
        userId,
        purpose,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + TTL_SECONDS[purpose] * 1000),
      },
    }),
  ]);

  return token;
}

/** Single-use: consumes the token and returns the owning user id. */
export async function consumeVerificationToken(
  rawToken: string,
  purpose: VerificationPurpose,
): Promise<string> {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });

  if (!record || record.purpose !== purpose || record.consumedAt) {
    throw new ApiError('invalid_request', 'This link is invalid or has already been used.');
  }

  if (record.expiresAt <= new Date()) {
    throw new ApiError('invalid_request', 'This link has expired. Request a new one.');
  }

  await prisma.verificationToken.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });

  return record.userId;
}
