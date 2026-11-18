import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { issueOtp, verifyOtp } from '@/lib/otp';
import { hashToken } from '@/lib/tokens';
import { resetDatabase } from './helpers';

const PHONE = '+919876543210';

/** The code is only ever printed by the console driver, so read it from its hash. */
async function currentCode(): Promise<string> {
  const row = await prisma.otpCode.findFirst({
    where: { phone: PHONE, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  for (let i = 0; i < 1_000_000; i += 1) {
    const candidate = String(i).padStart(6, '0');
    if (hashToken(candidate) === row!.codeHash) return candidate;
  }
  throw new Error('code not found');
}

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('phone one-time codes', () => {
  it('stores only a hash, never the code', async () => {
    await issueOtp(PHONE, 'PHONE_LOGIN');
    const row = await prisma.otpCode.findFirst({ where: { phone: PHONE } });
    expect(row!.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts the correct code exactly once', async () => {
    await issueOtp(PHONE, 'PHONE_LOGIN');
    const code = await currentCode();

    await expect(verifyOtp(PHONE, 'PHONE_LOGIN', code)).resolves.toBeUndefined();
    // Replaying a spent code must fail.
    await expect(verifyOtp(PHONE, 'PHONE_LOGIN', code)).rejects.toThrow();
  });

  it('rejects a wrong code and counts the attempt', async () => {
    await issueOtp(PHONE, 'PHONE_LOGIN');
    await expect(verifyOtp(PHONE, 'PHONE_LOGIN', '000000')).rejects.toThrow(/not valid/i);

    const row = await prisma.otpCode.findFirst({ where: { phone: PHONE } });
    expect(row!.attempts).toBe(1);
  });

  it('burns the code after five wrong attempts', async () => {
    await issueOtp(PHONE, 'PHONE_LOGIN');
    const code = await currentCode();

    for (let i = 0; i < 5; i += 1) {
      await expect(verifyOtp(PHONE, 'PHONE_LOGIN', '000000')).rejects.toThrow();
    }

    // Even the CORRECT code is dead once the cap is reached.
    await expect(verifyOtp(PHONE, 'PHONE_LOGIN', code)).rejects.toThrow();
  });

  it('rejects an expired code', async () => {
    await issueOtp(PHONE, 'PHONE_LOGIN');
    const code = await currentCode();
    await prisma.otpCode.updateMany({
      where: { phone: PHONE },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(verifyOtp(PHONE, 'PHONE_LOGIN', code)).rejects.toThrow(/expired/i);
  });

  it('RESEND invalidates the previous code, so it cannot widen the guessing window', async () => {
    await issueOtp(PHONE, 'PHONE_LOGIN');
    const first = await currentCode();

    await issueOtp(PHONE, 'PHONE_LOGIN');

    await expect(verifyOtp(PHONE, 'PHONE_LOGIN', first)).rejects.toThrow();
    const second = await currentCode();
    await expect(verifyOtp(PHONE, 'PHONE_LOGIN', second)).resolves.toBeUndefined();
  });
});
