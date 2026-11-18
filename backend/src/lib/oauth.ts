import { GitHub, Google, generateCodeVerifier, generateState } from 'arctic';
import { decodeJwt } from 'jose';
import { env } from './env';
import { ApiError } from './http';

export const PROVIDER_IDS = ['google', 'github'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

export interface NormalizedProfile {
  providerAccountId: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
}

function redirectUri(provider: ProviderId): string {
  return `${env.APP_URL}/api/auth/oauth/${provider}/callback`;
}

function credentials(provider: ProviderId): { id: string; secret: string } {
  const id = provider === 'google' ? env.GOOGLE_CLIENT_ID : env.GITHUB_CLIENT_ID;
  const secret =
    provider === 'google' ? env.GOOGLE_CLIENT_SECRET : env.GITHUB_CLIENT_SECRET;

  if (!id || !secret) {
    throw new ApiError(
      'provider_not_configured',
      `${provider} sign-in is not configured on this server.`,
    );
  }
  return { id, secret };
}

export function isProviderConfigured(provider: ProviderId): boolean {
  try {
    credentials(provider);
    return true;
  } catch {
    return false;
  }
}

export function configuredProviders(): ProviderId[] {
  return PROVIDER_IDS.filter(isProviderConfigured);
}

export interface AuthorizationRequest {
  url: URL;
  state: string;
  /** Google uses PKCE; GitHub does not. */
  codeVerifier: string | null;
}

export function createAuthorizationRequest(provider: ProviderId): AuthorizationRequest {
  const { id, secret } = credentials(provider);
  const state = generateState();

  if (provider === 'google') {
    const codeVerifier = generateCodeVerifier();
    const client = new Google(id, secret, redirectUri('google'));
    return {
      url: client.createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email']),
      state,
      codeVerifier,
    };
  }

  const client = new GitHub(id, secret, redirectUri('github'));
  return {
    url: client.createAuthorizationURL(state, ['read:user', 'user:email']),
    state,
    codeVerifier: null,
  };
}

export async function exchangeCodeForProfile(
  provider: ProviderId,
  code: string,
  codeVerifier: string | null,
): Promise<NormalizedProfile> {
  const { id, secret } = credentials(provider);

  if (provider === 'google') {
    if (!codeVerifier) {
      throw new ApiError('invalid_request', 'Missing PKCE verifier.');
    }
    const client = new Google(id, secret, redirectUri('google'));
    const tokens = await client.validateAuthorizationCode(code, codeVerifier);

    // The ID token arrives directly from Google's token endpoint over TLS in
    // response to our own authenticated request, so decoding without a second
    // signature check is safe here — there is no untrusted hop.
    const claims = decodeJwt(tokens.idToken()) as {
      sub: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };

    return {
      providerAccountId: claims.sub,
      email: claims.email?.toLowerCase() ?? null,
      emailVerified: claims.email_verified === true,
      displayName: claims.name ?? null,
      avatarUrl: claims.picture ?? null,
    };
  }

  const client = new GitHub(id, secret, redirectUri('github'));
  const tokens = await client.validateAuthorizationCode(code);
  const headers = {
    Authorization: `Bearer ${tokens.accessToken()}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'skyup-news-auth',
  };

  const userResponse = await fetch('https://api.github.com/user', { headers });
  if (!userResponse.ok) {
    throw new ApiError('internal_error', 'Could not read your GitHub profile.');
  }
  const profile = (await userResponse.json()) as {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string | null;
    email: string | null;
  };

  // GitHub omits the email from /user when it is private, so ask explicitly.
  let email = profile.email?.toLowerCase() ?? null;
  let emailVerified = false;

  const emailsResponse = await fetch('https://api.github.com/user/emails', { headers });
  if (emailsResponse.ok) {
    const emails = (await emailsResponse.json()) as Array<{
      email: string;
      primary: boolean;
      verified: boolean;
    }>;
    const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    if (primary) {
      email = primary.email.toLowerCase();
      emailVerified = primary.verified;
    }
  }

  return {
    providerAccountId: String(profile.id),
    email,
    emailVerified,
    displayName: profile.name ?? profile.login,
    avatarUrl: profile.avatar_url,
  };
}
