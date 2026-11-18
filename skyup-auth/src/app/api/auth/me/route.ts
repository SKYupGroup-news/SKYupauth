import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/current-user';
import { handleRoute } from '@/lib/http';

export const GET = handleRoute(async (request: Request) => {
  return NextResponse.json({ user: await requireUser(request) });
});
