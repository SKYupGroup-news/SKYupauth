import { NextResponse } from 'next/server';
import { isProduction } from '@/lib/env';
import { ApiError, handleRoute } from '@/lib/http';
import { createAuthorizationRequest, isProviderId } from '@/lib/oauth';

export const STATE_COOKIE = 'skyup_oauth_state';
export const VERIFIER_COOKIE = 'skyup_oauth_verifier';
export const RETURN_COOKIE = 'skyup_oauth_return';

const TEN_MINUTES = 600;

export const GET = handleRoute(
  async (request: Request, ctx: { params: Promise<{ provider: string }> }) => {
    const { provider } = await ctx.params;
    if (!isProviderId(provider)) {
      throw new ApiError('not_found', 'Unknown sign-in provider.');
    }

    const { url, state, codeVerifier } = createAuthorizationRequest(provider);

    // Only same-origin relative paths, so `?next=` cannot be used as an open redirect.
    const requested = new URL(request.url).searchParams.get('next');
    const next = requested?.startsWith('/') && !requested.startsWith('//') ? requested : '/account';

    const response = NextResponse.redirect(url);
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      // The provider redirects back cross-site, so "lax" is required for the
      // cookie to survive the round trip.
      sameSite: 'lax' as const,
      path: '/api/auth/oauth',
      maxAge: TEN_MINUTES,
    };

    response.cookies.set(STATE_COOKIE, state, cookieOptions);
    response.cookies.set(RETURN_COOKIE, next, cookieOptions);
    if (codeVerifier) {
      response.cookies.set(VERIFIER_COOKIE, codeVerifier, cookieOptions);
    }

    return response;
  },
);
