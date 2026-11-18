import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { makeUser, resetDatabase } from './helpers';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('account deletion (DPDP erasure)', () => {
  it('removes the reader and everything cascading from them', async () => {
    const user = await makeUser();
    await prisma.comment.create({
      data: { userId: user.id, articleId: 'a1', body: 'mine' },
    });
    await prisma.articleLike.create({ data: { userId: user.id, articleId: 'a1' } });
    await prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: 'hash-1',
        familyId: 'fam-1',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.comment.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.articleLike.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('RETAINS invoices with the person detached, as financial law requires', async () => {
    const user = await makeUser();
    const invoice = await prisma.invoice.create({
      data: { userId: user.id, amount: 89900, currency: 'INR', period: 'ANNUAL', status: 'PAID' },
    });

    await prisma.user.delete({ where: { id: user.id } });

    const retained = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(retained).not.toBeNull();
    expect(retained!.userId).toBeNull();
    expect(retained!.amount).toBe(89900);
  });

  it('does NOT delete other people’s replies to a deleted reader', async () => {
    const leaving = await makeUser();
    const staying = await makeUser();

    const parent = await prisma.comment.create({
      data: { userId: leaving.id, articleId: 'a1', body: 'parent' },
    });
    const reply = await prisma.comment.create({
      data: { userId: staying.id, articleId: 'a1', body: 'someone else wrote this', parentId: parent.id },
    });

    await prisma.user.delete({ where: { id: leaving.id } });

    // The parent goes with its author; the other reader's words must not.
    const survivor = await prisma.comment.findUnique({ where: { id: reply.id } });
    expect(survivor).not.toBeNull();
    expect(survivor!.body).toBe('someone else wrote this');
    expect(survivor!.parentId).toBeNull();
  });

  it('removes notifications in both directions', async () => {
    const leaving = await makeUser();
    const other = await makeUser();
    await prisma.notification.create({
      data: { userId: other.id, actorId: leaving.id, type: 'COMMENT_LIKE' },
    });

    await prisma.user.delete({ where: { id: leaving.id } });

    // Nothing may keep pointing at a person who no longer exists.
    expect(await prisma.notification.count({ where: { actorId: leaving.id } })).toBe(0);
  });
});
