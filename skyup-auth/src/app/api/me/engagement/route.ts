import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/current-user';
import { handleRoute } from '@/lib/http';
import { getMyEngagement } from '@/lib/engagement';

/**
 * Everything the reader app needs to restore a reader's own activity at login:
 * which articles they liked, what they wrote, and the unread badge count.
 */
export const GET = handleRoute(async (request: Request) => {
  const user = await requireUser(request);
  return NextResponse.json(await getMyEngagement(user.id));
});
