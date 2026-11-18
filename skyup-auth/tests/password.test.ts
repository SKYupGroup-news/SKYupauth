import { describe, expect, it } from 'vitest';
import { fakeVerify, hashPassword, verifyPassword } from '@/lib/password';

describe('password hashing', () => {
  it('produces an argon2id digest, never the password itself', async () => {
    const digest = await hashPassword('correct-horse-battery');
    expect(digest).toMatch(/^\$argon2id\$/);
    expect(digest).not.toContain('correct-horse-battery');
  });

  it('salts: the same password hashes differently every time', async () => {
    const a = await hashPassword('correct-horse-battery');
    const b = await hashPassword('correct-horse-battery');
    expect(a).not.toBe(b);
  });

  it('accepts the right password and rejects the wrong one', async () => {
    const digest = await hashPassword('correct-horse-battery');
    expect(await verifyPassword(digest, 'correct-horse-battery')).toBe(true);
    expect(await verifyPassword(digest, 'wrong-horse-battery')).toBe(false);
  });

  it('treats a malformed digest as a wrong password, not a crash', async () => {
    expect(await verifyPassword('not-a-digest', 'anything')).toBe(false);
  });

  it('fakeVerify burns comparable time so missing accounts are not detectable', async () => {
    const digest = await hashPassword('correct-horse-battery');

    const realStart = performance.now();
    await verifyPassword(digest, 'wrong-horse-battery');
    const realMs = performance.now() - realStart;

    const fakeStart = performance.now();
    await fakeVerify();
    const fakeMs = performance.now() - fakeStart;

    // Same order of magnitude is what defeats timing analysis; exact parity is
    // neither achievable nor necessary.
    expect(fakeMs).toBeGreaterThan(realMs * 0.2);
    expect(fakeMs).toBeLessThan(realMs * 5);
  });
});
