import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser, toPublicUser } from '@/lib/current-user';
import { handleRoute, parseJson } from '@/lib/http';
import { updateProfileSchema } from '@/lib/validation';
import { dropCachedSessionsForUser } from '@/lib/session-cache';

export const GET = handleRoute(async (request: Request) => {
  return NextResponse.json({ user: await requireUser(request) });
});

export const PATCH = handleRoute(async (request: Request) => {
  const current = await requireUser(request);
  const input = await parseJson(request, updateProfileSchema);

  // Only copy keys the client actually sent, so omitted fields keep their
  // stored value instead of being nulled out.
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    data[key] = key === 'dateOfBirth' && value ? new Date(String(value)) : value;
  }

  const user = await prisma.user.update({
    where: { id: current.id },
    data,
  });

  // The cached session carries the profile, so a save must evict it.
  await dropCachedSessionsForUser(current.id);

  return NextResponse.json({ user: toPublicUser(user) });
});
