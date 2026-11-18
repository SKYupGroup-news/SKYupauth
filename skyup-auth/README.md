# SkyUp News — Authentication

Authentication service for the SkyUp News platform. Next.js (App Router) + TypeScript,
Prisma + PostgreSQL, JWT access tokens with rotating refresh tokens.

Three ways in, one account: **email + password**, **phone OTP**, and **OAuth social login**.
All of them resolve to the same `User` row, so a reader who starts with a phone number and
later links Google keeps one identity.

---

## Quick start

```bash
npm install
cp .env.example .env          # then fill in DATABASE_URL and JWT_SECRET
npm run db:migrate            # creates the schema
npm run db:seed               # optional: creates an admin user
npm run dev
```

Open http://localhost:3000 — you'll be routed to `/login`.

With `EMAIL_DRIVER=console` and `SMS_DRIVER=console` (the defaults) verification links and
OTP codes are printed to the terminal running `npm run dev`, so you can exercise every flow
without an email or SMS provider.

### Generating a JWT secret

```bash
openssl rand -base64 48
```

---

## API

All endpoints live under `/api/auth`. Request and response bodies are JSON. Errors share one
shape: `{ "error": { "code": "...", "message": "...", "details": [...] } }`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/register` | Create an account with email + password. Signs in and emails a confirmation link. |
| `POST` | `/login` | Email + password sign-in. |
| `POST` | `/logout` | Revokes the current refresh token and clears cookies. |
| `POST` | `/refresh` | Exchanges a refresh token for a new access/refresh pair. |
| `GET` | `/me` | Returns the signed-in user. |
| `POST` | `/verify-email` | Consumes an email confirmation token. |
| `POST` | `/password/forgot` | Emails a reset link. Always returns 200. |
| `POST` | `/password/reset` | Sets a new password and revokes every session. |
| `POST` | `/otp/request` | Sends a 6-digit SMS code. |
| `POST` | `/otp/verify` | Verifies the code; creates the account if the number is new. |
| `GET` | `/oauth/{provider}` | Redirects to Google or GitHub. Accepts `?next=/path`. |
| `GET` | `/oauth/{provider}/callback` | Handles the provider redirect and signs the user in. |

### Profile

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/profile` | The signed-in reader's full profile. |
| `PATCH` | `/api/profile` | Partial update: name, bio, avatar, DOB, topics, notification prefs. |
| `POST` | `/api/profile/password` | Change password (requires the current one). Revokes all sessions. |

### Engagement

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`/`POST` | `/api/articles/{id}/like` | Like state, and toggle it. |
| `GET` | `/api/articles/{id}/likes` | Who liked the article. **Public.** |
| `GET`/`POST` | `/api/articles/{id}/comments` | Threaded comments; post one (optional `parentId`). |
| `DELETE` | `/api/comments/{id}` | Soft-delete your own (or any, as ADMIN). |
| `POST` | `/api/comments/{id}/like` | Toggle a like on a comment. |
| `GET` | `/api/comments/{id}/likes` | Who liked the comment. **Public.** |
| `GET`/`POST` | `/api/notifications` | Who liked/replied to you; mark read. |
| `GET` | `/api/me/engagement` | This reader's likes and comments, for login bootstrap. |

**Liker lists are public.** Any visitor, signed in or not, can see who liked a
comment or article. This was a deliberate product decision — it is worth knowing
that it cannot be walked back once the lists have been read or scraped, and that
on a news platform a like is closer to a political disclosure than it is on a
photo-sharing app. Only the narrow public author shape (id, name, avatar) is ever
returned; email and phone are never exposed here.

Withdrawn comments expose nothing: body, like count and liker list all go empty,
and the liker endpoint returns 404.

### Subscription & billing

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/subscription` | Entitlement, live plan catalog, and invoice history. |
| `GET` | `/api/entitlement` | Cheap premium gate. Returns a free entitlement for guests, not a 401. |
| `POST` | `/api/subscription/checkout` | Creates a Razorpay order and a PENDING invoice. |
| `POST` | `/api/subscription/confirm` | Verifies the checkout signature and activates access. |
| `POST` | `/api/subscription/cancel` | Cancels at period end; access is kept until then. |
| `POST` | `/api/subscription/resume` | Undoes a pending cancellation. |
| `POST` | `/api/webhooks/razorpay` | Signed webhook. The source of truth for billing state. |
| `POST` | `/api/admin/subscription/grant` | ADMIN only: complimentary Premium. |
| `GET` | `/api/admin/audience` | ADMIN only: paginated reader list + summary counts. Filter with `?filter=all\|premium\|free\|cancelling` and search with `?q=`. |

### Audience view

`/admin/audience` (ADMIN only, linked from the account page) shows every reader and
whether they are paying: a KPI row, the paid share of the audience, and a searchable,
filterable table with per-row "Grant Premium".

The "paid" filter is computed in SQL the same way `entitlementFrom` computes it in
code — status **and** an unexpired period — so a subscription row that still says
`ACTIVE` after its period ran out correctly lists as **Lapsed**, not paid.

Browsers are served `httpOnly` cookies. Native and API clients can instead read `accessToken`
from the response body and send `Authorization: Bearer <token>`.

---

## How subscription works

The plan **catalog** (pricing, features, promo codes) stays in the platform's
`subscription-service` on :8083 — Finance can change prices there without deploying
this app. This service owns **per-user state**: who is entitled to Premium, until
when, and what they were charged.

Entitlement is always *derived* from `status` + `currentPeriodEnd`, never stored as a
boolean. A lapsed subscription stops granting access the moment its period ends, with
no cron job needed to flip a flag.

Two rules worth keeping:

- **Prices are resolved server-side on every checkout.** The client posts only a period
  and an optional promo code; the amount and discount are read from the catalog. A client
  that posts its own amount is ignored, which is what prevents "₹1 Premium".
- **The signed webhook is the source of truth**, not the browser callback. If a reader
  closes the tab mid-redirect they still get access. Event ids are recorded, so the
  provider's retries cannot double-apply a payment.

Cancelling sets `cancelAtPeriodEnd` rather than revoking immediately — readers keep what
they paid for. A refund webhook is the one case that ends access at once.

## How sessions work

Sign-in issues two tokens:

- **Access token** — a short-lived (15 min) HS256 JWT carrying `sub`, `sid`, and `role`.
- **Refresh token** — a 32-byte opaque secret. Only its SHA-256 is stored, so a database
  leak does not hand an attacker usable tokens.

Refresh is **single-use**. Each rotation writes a new row in the same `familyId` and marks the
old one rotated. If an already-rotated token is presented again, that is treated as a replay
of a stolen token: the entire family is revoked and the user must sign in again.

`getCurrentUser()` re-reads the session row on every call, so revoking a session takes effect
immediately rather than after the access token expires.

---

## Security decisions worth knowing

- **Passwords** use argon2id at the OWASP baseline (19 MiB, 2 passes). Login against a
  non-existent account still runs a hash so response timing does not reveal which emails
  are registered.
- **OAuth account linking by email happens only when the provider says the address is
  verified.** Some providers let a user attach an unverified address to their profile;
  auto-linking on that would let an attacker claim a SkyUp account by typing someone
  else's email at the provider.
- **Password reset revokes every session**, since a reset is the usual response to a
  suspected compromise.
- **`/password/forgot` always returns the same response** whether or not the account exists.
- **OTP codes** expire in 5 minutes, allow 5 attempts, and a resend invalidates the previous
  code so a resend cannot widen the guessing window.
- **Rate limits** are counted in Postgres (not in memory), so they hold across serverless
  instances. Login is limited per-IP *and* per-email.
- **`?next=`** on the OAuth entry point only accepts same-origin relative paths, closing the
  open-redirect hole.

---

## Configuration

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres 14+. |
| `JWT_SECRET` | yes | 32+ characters. |
| `APP_URL` | yes | Used to build email links and OAuth redirect URIs. |
| `ACCESS_TOKEN_TTL_SECONDS` | no | Default 900. |
| `REFRESH_TOKEN_TTL_SECONDS` | no | Default 2592000 (30 days). |
| `EMAIL_DRIVER` | no | `console` (default) or `resend`. |
| `SMS_DRIVER` | no | `console` (default) or `twilio`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | Google sign-in is hidden when unset. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | no | GitHub sign-in is hidden when unset. |

The environment is validated at startup in [src/lib/env.ts](src/lib/env.ts) — a misconfigured
deploy fails immediately rather than at the first request that needs the variable.

### OAuth redirect URIs

Register these with each provider:

```
{APP_URL}/api/auth/oauth/google/callback
{APP_URL}/api/auth/oauth/github/callback
```

---

## Layout

```
prisma/schema.prisma          data model
src/lib/                      auth core (sessions, tokens, OTP, OAuth, rate limits)
src/app/api/auth/             HTTP endpoints
src/app/                      sign-in, sign-up, reset, and account pages
```

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Development server. |
| `npm run build` | Production build. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint. |
| `npm run db:migrate` | Create/apply a development migration. |
| `npm run db:deploy` | Apply migrations in production. |
| `npm run db:seed` | Seed an admin user. |
| `npm run db:studio` | Browse the database. |

---

## Wiring the reader app

The audience-side Vite app (`../../SKYup News audience side`) talks to this service via
`src/services/authApi.js`. Point it here with:

```
VITE_AUTH_SERVICE_URL=http://localhost:3100
```

`authApi.js` also contains `toUiUser()`, which translates this service's vocabulary
(`displayName`, `avatarUrl`, `entitlement`) into the shape the existing components
expect (`name`, `avatar`, `plan`, `planName`). That adapter is why the reader app's
profile and header components did not need rewriting.

Sessions ride on httpOnly cookies. Different **ports** on localhost are already
same-site, so cookies flow between :3000 and :3100 in development. In production, if
the reader app and this service sit on different subdomains, set:

```
COOKIE_DOMAIN=".skyupnews.com"
ALLOWED_ORIGINS="https://www.skyupnews.com"
```

## Known issue: `npm run dev` does not hydrate

On this machine (**Node 25**, Next 16.3.4) pages served by `next dev` render but never
hydrate — no event handlers attach, so forms and filters do nothing in the browser.
It reproduces with both Turbopack and `next dev --webpack`, and there is no console
error, failed chunk, or server-side error. The production build is unaffected and
fully interactive.

Until it is resolved, browse the UI from a production build:

```bash
npm run build && npm start -- -p 3100
```

API routes are server-side and work fine under `next dev`, so the reader-app
integration is not affected either way. Node 25 is a non-LTS release and is the most
likely cause — trying Node 22 LTS is the first thing to check.

## Not built yet

Deliberately out of scope for this first pass:

- Expired-row cleanup for `sessions`, `otp_codes`, `verification_tokens`, and `rate_limits`
  (a periodic job, or Postgres `pg_cron`).
- A "sign out of all devices" control and a per-session list in the account page.
- Two-factor authentication for editor and admin roles.
- Apple sign-in (the schema and provider registry already allow for it).
- Automated tests.
- Razorpay **recurring** subscriptions. Checkout currently charges a one-off order per
  period and extends the entitlement; auto-renewal needs Razorpay Subscriptions plus a
  `subscription.charged` webhook handler.
- Currency: the catalog is priced in USD while Razorpay settles primarily in INR.
  Decide one before taking real payments — the code reads `currencyCode` from the
  catalog, so it is a config change, not a rewrite.
- Reading activity (bookmarks, history, followed categories) still lives in the reader
  app's localStorage; only identity, profile and subscription moved server-side.
