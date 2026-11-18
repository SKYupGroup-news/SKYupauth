import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { getArticleThread, notify, toPublicAuthor } from '@/lib/engagement';
import { makeUser, resetDatabase } from './helpers';

const ARTICLE = 'art-test-1';

async function comment(userId: string, body: string, parentId?: string) {
  return prisma.comment.create({
    data: { userId, articleId: ARTICLE, articleTitle: 'Test story', body, parentId },
  });
}

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('comment threads', () => {
  it('nests replies under their parent', async () => {
    const author = await makeUser();
    const root = await comment(author.id, 'Top level');
    await comment(author.id, 'A reply', root.id);

    const { comments } = await getArticleThread(ARTICLE, null);
    expect(comments).toHaveLength(1);
    expect(comments[0]!.replies).toHaveLength(1);
    expect(comments[0]!.replies[0]!.body).toBe('A reply');
  });

  it('SOFT DELETE withdraws the text but keeps replies readable', async () => {
    const author = await makeUser();
    const root = await comment(author.id, 'Parent that gets removed');
    await comment(author.id, 'Reply that must survive', root.id);

    await prisma.comment.update({ where: { id: root.id }, data: { deletedAt: new Date() } });

    const { comments } = await getArticleThread(ARTICLE, null);
    expect(comments[0]!.deleted).toBe(true);
    expect(comments[0]!.body).toBeNull();
    expect(comments[0]!.replies[0]!.body).toBe('Reply that must survive');
  });

  it('a withdrawn comment exposes no engagement at all', async () => {
    const author = await makeUser();
    const liker = await makeUser();
    const root = await comment(author.id, 'Removed but liked');
    await prisma.commentLike.create({ data: { userId: liker.id, commentId: root.id } });
    await prisma.comment.update({
      where: { id: root.id },
      data: { likeCount: 1, deletedAt: new Date() },
    });

    const { comments } = await getArticleThread(ARTICLE, null);
    expect(comments[0]!.likeCount).toBe(0);
    expect(comments[0]!.likedBy).toEqual([]);
  });

  it('pages with a cursor rather than loading the whole thread', async () => {
    const author = await makeUser();
    for (let i = 0; i < 5; i += 1) await comment(author.id, `Comment ${i}`);

    const first = await getArticleThread(ARTICLE, null, { limit: 2 });
    expect(first.comments).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await getArticleThread(ARTICLE, null, {
      limit: 2,
      cursor: first.nextCursor,
    });
    const overlap = first.comments.filter((c) =>
      second.comments.some((s) => s.id === c.id),
    );
    expect(overlap).toHaveLength(0);
  });

  it('reports likedByMe per viewer', async () => {
    const author = await makeUser();
    const viewer = await makeUser();
    const root = await comment(author.id, 'Liked by the viewer');
    await prisma.commentLike.create({ data: { userId: viewer.id, commentId: root.id } });

    const mine = await getArticleThread(ARTICLE, viewer.id);
    const theirs = await getArticleThread(ARTICLE, author.id);
    expect(mine.comments[0]!.likedByMe).toBe(true);
    expect(theirs.comments[0]!.likedByMe).toBe(false);
  });

  it('only the author or an admin may delete', async () => {
    const author = await makeUser();
    const other = await makeUser();
    await comment(author.id, 'Whose comment is it');

    const asAuthor = await getArticleThread(ARTICLE, author.id);
    const asOther = await getArticleThread(ARTICLE, other.id);
    const asAdmin = await getArticleThread(ARTICLE, other.id, { isAdmin: true });

    expect(asAuthor.comments[0]!.canDelete).toBe(true);
    expect(asOther.comments[0]!.canDelete).toBe(false);
    expect(asAdmin.comments[0]!.canDelete).toBe(true);
  });
});

describe('public author projection', () => {
  it('never exposes an email or phone in a public thread', async () => {
    const user = await makeUser({ email: 'private@test.local', displayName: undefined });
    await prisma.user.update({
      where: { id: user.id },
      data: { displayName: null, phone: '+919999999999' },
    });
    const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    const author = toPublicAuthor(reloaded);
    expect(JSON.stringify(author)).not.toContain('private@test.local');
    expect(JSON.stringify(author)).not.toContain('+919999999999');
    expect(author.name).toBe('Reader');
  });
});

describe('notifications', () => {
  it('notifies the recipient of another reader’s action', async () => {
    const owner = await makeUser();
    const actor = await makeUser();
    await notify({ recipientId: owner.id, actorId: actor.id, type: 'COMMENT_LIKE' });

    expect(await prisma.notification.count({ where: { userId: owner.id } })).toBe(1);
  });

  it('SELF-ACTIONS never notify', async () => {
    const user = await makeUser();
    await notify({ recipientId: user.id, actorId: user.id, type: 'COMMENT_LIKE' });

    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0);
  });

  it('snapshots the text so it still reads after the comment is deleted', async () => {
    const owner = await makeUser();
    const actor = await makeUser();
    await notify({
      recipientId: owner.id,
      actorId: actor.id,
      type: 'COMMENT_REPLY',
      preview: 'The original wording',
    });

    const row = await prisma.notification.findFirstOrThrow({ where: { userId: owner.id } });
    expect(row.preview).toBe('The original wording');
  });
});
