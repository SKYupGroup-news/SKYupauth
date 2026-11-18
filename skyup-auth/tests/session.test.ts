import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  createSession,
  revokeAllSessions,
  revokeSessionByToken,
  rotateSession,
} from '@/lib/session';
import { verifyAccessToken } from '@/lib/tokens';
import { fakeRequest, makeUser, resetDatabase } from './helpers';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('refresh token rotation', () => {
  it('issues a working access token tied to the session', async () => {
    const user = await makeUser();
    const tokens = await createSession(user, fakeRequest());

    const claims = await verifyAccessToken(tokens.accessToken);
    expect(claims?.sub).toBe(user.id);
    expect(claims?.sid).toBe(tokens.sessionId);
  });

  it('replaces the refresh token on every rotation', async () => {
    const user = await makeUser();
    const first = await createSession(user, fakeRequest());
    const second = await rotateSession(first.refreshToken, fakeRequest());

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.sessionId).not.toBe(first.sessionId);
  });

  it('keeps a rotated session in the same family', async () => {
    const user = await makeUser();
    const first = await createSession(user, fakeRequest());
    const second = await rotateSession(first.refreshToken, fakeRequest());

    const rows = await prisma.session.findMany({ where: { userId: user.id } });
    const families = new Set(rows.map((row) => row.familyId));
    expect(families.size).toBe(1);
    expect(rows.find((r) => r.id === first.sessionId)?.replacedById).toBe(second.sessionId);
  });

  it('REPLAY: reusing a rotated token revokes the whole family', async () => {
    const user = await makeUser();
    const first = await createSession(user, fakeRequest());
    const second = await rotateSession(first.refreshToken, fakeRequest());

    // An attacker presents the token the legitimate client already spent.
    await expect(rotateSession(first.refreshToken, fakeRequest())).rejects.toThrow(
      /reuse detected/i,
    );

    // The legitimate client's newer token must die with it.
    await expect(rotateSession(second.refreshToken, fakeRequest())).rejects.toThrow();

    const live = await prisma.session.count({
      where: { userId: user.id, revokedAt: null },
    });
    expect(live).toBe(0);
  });

  it('rejects an expired refresh token', async () => {
    const user = await makeUser();
    const tokens = await createSession(user, fakeRequest());
    await prisma.session.update({
      where: { id: tokens.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(rotateSession(tokens.refreshToken, fakeRequest())).rejects.toThrow(/expired/i);
  });

  it('refuses to rotate for a suspended account', async () => {
    const user = await makeUser();
    const tokens = await createSession(user, fakeRequest());
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });

    await expect(rotateSession(tokens.refreshToken, fakeRequest())).rejects.toThrow(
      /no longer active/i,
    );
  });

  it('rejects an unknown token', async () => {
    await expect(rotateSession('not-a-real-token', fakeRequest())).rejects.toThrow(/invalid/i);
  });
});

describe('revocation', () => {
  it('revokes a single session on sign-out', async () => {
    const user = await makeUser();
    const tokens = await createSession(user, fakeRequest());
    await revokeSessionByToken(tokens.refreshToken);

    const row = await prisma.session.findUnique({ where: { id: tokens.sessionId } });
    expect(row?.revokedAt).not.toBeNull();
  });

  it('revokes every device at once', async () => {
    const user = await makeUser();
    await createSession(user, fakeRequest());
    await createSession(user, fakeRequest());
    await createSession(user, fakeRequest());

    await revokeAllSessions(user.id);

    const live = await prisma.session.count({ where: { userId: user.id, revokedAt: null } });
    expect(live).toBe(0);
  });

  it('never stores the raw refresh token', async () => {
    const user = await makeUser();
    const tokens = await createSession(user, fakeRequest());

    const row = await prisma.session.findUnique({ where: { id: tokens.sessionId } });
    expect(row?.refreshTokenHash).not.toBe(tokens.refreshToken);
    expect(row?.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
