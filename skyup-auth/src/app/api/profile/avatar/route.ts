import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/current-user';
import { ApiError, handleRoute, parseJson } from '@/lib/http';
import { MAX_AVATAR_BYTES, decodeDataUri } from '@/lib/avatar';
import { deleteAvatar, putAvatar } from '@/lib/avatar-store';

const schema = z.object({
  // Bounded before decoding so an enormous string is rejected cheaply.
  dataUri: z.string().min(1).max(MAX_AVATAR_BYTES * 2),
});

export const POST = handleRoute(async (request: Request) => {
  const user = await requireUser(request);
  const { dataUri } = await parseJson(request, schema);

  const decoded = decodeDataUri(dataUri);
  if ('error' in decoded) {
    throw new ApiError('invalid_request', decoded.error);
  }

  // Routed through the store so the driver (database / disk / S3+CDN) is a
  // configuration choice rather than a code change here.
  await putAvatar(user.id, decoded);

  // An uploaded picture supersedes any external avatar URL on the profile.
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { avatarUrl: null, avatarUpdatedAt: new Date() },
  });

  return NextResponse.json({
    ok: true,
    // Version-stamped so the new picture replaces the old one immediately.
    avatarSrc: `/api/avatar/${user.id}?v=${updated.avatarUpdatedAt!.getTime()}`,
    bytes: decoded.data.length,
  });
});

export const DELETE = handleRoute(async (request: Request) => {
  const user = await requireUser(request);
  await deleteAvatar(user.id);
  await prisma.user.update({
    where: { id: user.id },
    data: { avatarUpdatedAt: null },
  });
  return NextResponse.json({ ok: true });
});
