import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { handleRoute } from '@/lib/http';
import { exchangeCodeForProfile, isProviderId, type NormalizedProfile } from '@/lib/oauth';
import { createSession, setAuthCookies } from '@/lib/session';
import { constantTimeEquals } from '@/lib/tokens';
import { RETURN_COOKIE, STATE_COOKIE, VERIFIER_COOKIE } from '../route';
import type { ProviderId } from '@/lib/oauth';
import type { User } from '@/generated/prisma';

function failure(reason: string) {
  const response = NextResponse.redirect(
    `${env.APP_URL}/login?error=${encodeURIComponent(reason)}`,
  );
  for (const name of [STATE_COOKIE, VERIFIER_COOKIE, RETURN_COOKIE]) {
    response.cookies.set(name, '', { path: '/api/auth/oauth', maxAge: 0 });
  }
  return response;
}

/**
 * Resolves a provider profile to a local account.
 *
 * Linking by email happens ONLY when the provider states the address is
 * verified. Some providers let a user attach an unverified address to their
 * profile; auto-linking on that would let an attacker claim someone else's
 * SkyUp account just by typing their email at the provider.
 */
async function resolveUser(provider: ProviderId, profile: NormalizedProfile): Promise<User> {
  const linked = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider,
        providerAccountId: profile.providerAccountId,
      },
    },
    include: { user: true },
  });

  if (linked) return linked.user;

  if (profile.email && profile.emailVerified) {
    const existing = await prisma.user.findUnique({ where: { email: profile.email } });
    if (existing) {
      await prisma.oAuthAccount.create({
        data: {
          userId: existing.id,
          provider,
          providerAccountId: profile.providerAccountId,
        },
      });

      // Fill in gaps without overwriting anything the user set themselves.
      return prisma.user.update({
        where: { id: existing.id },
        data: {
          emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
          displayName: existing.displayName ?? profile.displayName,
          avatarUrl: existing.avatarUrl ?? profile.avatarUrl,
        },
      });
    }
  }

  return prisma.user.create({
    data: {
      email: profile.email,
      emailVerifiedAt: profile.email && profile.emailVerified ? new Date() : null,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      oauthAccounts: {
        create: { provider, providerAccountId: profile.providerAccountId },
      },
    },
  });
}

export const GET = handleRoute(
  async (request: Request, ctx: { params: Promise<{ provider: string }> }) => {
    const { provider } = await ctx.params;
    if (!isProviderId(provider)) return failure('unknown_provider');

    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (url.searchParams.get('error')) return failure('provider_denied');
    if (!code || !state) return failure('missing_code');

    const store = await cookies();
    const expectedState = store.get(STATE_COOKIE)?.value;
    const codeVerifier = store.get(VERIFIER_COOKIE)?.value ?? null;
    const next = store.get(RETURN_COOKIE)?.value ?? '/account';

    // CSRF defence: the state we issued must come back unchanged.
    if (!expectedState || !constantTimeEquals(expectedState, state)) {
      return failure('invalid_state');
    }

    let profile: NormalizedProfile;
    try {
      profile = await exchangeCodeForProfile(provider, code, codeVerifier);
    } catch (error) {
      console.error(`[auth] ${provider} code exchange failed:`, error);
      return failure('exchange_failed');
    }

    const user = await resolveUser(provider, profile);

    if (user.status !== 'ACTIVE') return failure('account_suspended');
    if (user.role !== 'ADMIN') return failure('admin_only');

    const tokens = await createSession(user, request);
    const response = NextResponse.redirect(`${env.APP_URL}${next}`);

    for (const name of [STATE_COOKIE, VERIFIER_COOKIE, RETURN_COOKIE]) {
      response.cookies.set(name, '', { path: '/api/auth/oauth', maxAge: 0 });
    }

    return setAuthCookies(response, tokens);
  },
);
