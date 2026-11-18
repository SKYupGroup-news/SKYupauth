import { describe, expect, it } from 'vitest';
import {
  constantTimeEquals,
  generateNumericCode,
  generateOpaqueToken,
  hashToken,
  signAccessToken,
  verifyAccessToken,
} from '@/lib/tokens';

describe('access tokens', () => {
  it('round-trips its claims', async () => {
    const token = await signAccessToken({ userId: 'u1', sessionId: 's1', role: 'READER' });
    const claims = await verifyAccessToken(token);
    expect(claims).toMatchObject({ sub: 'u1', sid: 's1', role: 'READER' });
  });

  it('rejects a tampered token', async () => {
    const token = await signAccessToken({ userId: 'u1', sessionId: 's1', role: 'READER' });
    // Flip the role claim in the payload; the signature must no longer verify.
    const [header, payload, signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    decoded.role = 'ADMIN';
    const forged = `${header}.${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`;

    expect(await verifyAccessToken(forged)).toBeNull();
  });

  it('rejects nonsense rather than throwing', async () => {
    expect(await verifyAccessToken('not.a.token')).toBeNull();
    expect(await verifyAccessToken('')).toBeNull();
  });
});

describe('opaque tokens and codes', () => {
  it('generates unique, high-entropy tokens', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateOpaqueToken()));
    expect(tokens.size).toBe(500);
  });

  it('hashes to a stable sha256 that is not the input', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe('abc');
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates six-digit codes across the full range', () => {
    const codes = Array.from({ length: 300 }, () => generateNumericCode(6));
    expect(codes.every((c) => /^\d{6}$/.test(c))).toBe(true);
    // Uniform generation should produce more than a handful of distinct values.
    expect(new Set(codes).size).toBeGreaterThan(200);
  });

  it('compares in constant time without throwing on length mismatch', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
  });
});
