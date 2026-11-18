'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Entitlement {
  isPremium: boolean;
  status: string;
  period: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  daysRemaining: number | null;
}

interface Invoice {
  id: string;
  amount: number;
  originalAmount: number | null;
  currency: string;
  status: string;
  period: string;
  promoCode: string | null;
  discountPercent: number | null;
  paymentMethod: string | null;
  failureReason: string | null;
  issuedAt: string;
  paidAt: string | null;
}

interface SessionRow {
  id: string;
  signedInAt: string;
  expiresAt: string;
  userAgent: string | null;
  ip: string | null;
  active: boolean;
  revokedAt: string | null;
}

interface Detail {
  reader: {
    id: string;
    email: string | null;
    emailVerified: boolean;
    phone: string | null;
    phoneVerified: boolean;
    displayName: string | null;
    avatarUrl: string | null;
    avatarSrc: string | null;
    bio: string | null;
    dateOfBirth: string | null;
    locale: string;
    timezone: string | null;
    country: string | null;
    state: string | null;
    city: string | null;
    contactPhone: string | null;
    digestFrequency: string;
    preferredTopics: string[];
    role: string;
    status: string;
    createdAt: string;
    hasPassword: boolean;
    notifications: { breakingNews: boolean; newsletter: boolean; productNews: boolean };
  };
  entitlement: Entitlement;
  subscription: {
    planKey: string;
    status: string;
    period: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    canceledAt: string | null;
    grantedByUserId: string | null;
    grantNote: string | null;
  } | null;
  signIns: {
    password: boolean;
    phoneOtp: boolean;
    oauth: Array<{ provider: string; linkedAt: string }>;
  };
  billing: {
    lifetimeValue: number;
    currency: string;
    paidCount: number;
    invoices: Invoice[];
  };
  engagement: {
    articleLikes: number;
    comments: number;
    likesReceived: number;
    unreadNotifications: number;
    recentComments: Array<{
      id: string;
      articleId: string;
      articleTitle: string | null;
      body: string;
      isReply: boolean;
      likeCount: number;
      replyCount: number;
      createdAt: string;
    }>;
  };
  accountActions: Array<{
    id: string;
    type: 'SUSPEND' | 'REINSTATE';
    reason: string;
    actor: { id: string; name: string; avatarSrc: string | null };
    createdAt: string;
  }>;
  activity: SessionRow[];
  activeSessionCount: number;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function money(amount: number, currency: string): string {
  const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : '';
  return `${symbol}${amount.toFixed(2)}`;
}

/** Condenses a user-agent into something scannable in a table. */
function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser =
    /Edg\//.test(userAgent) ? 'Edge'
    : /Chrome\//.test(userAgent) ? 'Chrome'
    : /Safari\//.test(userAgent) ? 'Safari'
    : /Firefox\//.test(userAgent) ? 'Firefox'
    : /curl/i.test(userAgent) ? 'curl'
    : 'Browser';
  const os =
    /iPhone|iPad/.test(userAgent) ? 'iOS'
    : /Android/.test(userAgent) ? 'Android'
    : /Mac OS X|Macintosh/.test(userAgent) ? 'macOS'
    : /Windows/.test(userAgent) ? 'Windows'
    : /Linux/.test(userAgent) ? 'Linux'
    : '';
  return os ? `${browser} · ${os}` : browser;
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{title}</h2>
        {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
      </div>
      <div className="mt-2.5 rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="min-w-0 text-right text-sm font-medium break-words">{value}</span>
    </div>
  );
}

function Tag({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
      }`}
    >
      {children}
    </span>
  );
}

export function ReaderDetail({ userId }: { userId: string }) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // Guarded so a fast navigation away cannot set state on a gone component.
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/api/admin/audience/${userId}`);
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error?.message ?? 'Could not load this reader.');
        }
        if (!cancelled) setData(payload as Detail);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Could not load this reader.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, reloadKey]);

  async function changeStatus(action: 'SUSPEND' | 'REINSTATE') {
    setWorking(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/admin/audience/${userId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.details?.[0]?.message ?? payload?.error?.message);
      }
      setReason('');
      // Reload so the status badge and the audit list both reflect the change.
      setReloadKey((key) => key + 1);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not update the account.');
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        <p className="text-sm text-muted">Loading reader…</p>
      </main>
    );
  }

  if (error || !data || !data.reader) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        <Link href="/admin/audience" className="text-sm text-brand hover:underline">
          ← Back to audience
        </Link>
        <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger">
          {error ?? 'Reader not found.'}
        </p>
      </main>
    );
  }

  const { reader, entitlement, subscription, signIns, billing, activity, engagement, accountActions } = data;
  const suspended = reader.status === 'SUSPENDED';
  const name = reader.displayName ?? reader.email ?? reader.phone ?? 'Unnamed reader';

  const methods = [
    signIns.password && 'Password',
    signIns.phoneOtp && 'Phone OTP',
    ...signIns.oauth.map((account) => account.provider),
  ].filter(Boolean) as string[];

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
      <Link href="/admin/audience" className="text-sm text-brand hover:underline">
        ← Back to audience
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {reader.avatarSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={reader.avatarSrc}
              alt=""
              width={48}
              height={48}
              className="h-12 w-12 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand/10 text-sm font-semibold text-brand"
            >
              {name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight break-words">{name}</h1>
          <p className="mt-1 text-sm text-muted">
            Joined {formatDate(reader.createdAt)} · {reader.role.toLowerCase()}
              {reader.status !== 'ACTIVE' && ` · ${reader.status.toLowerCase()}`}
            </p>
          </div>
        </div>

        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            suspended
              ? 'bg-danger/10 text-danger'
              : entitlement.isPremium
                ? 'bg-success/10 text-success'
                : 'bg-brand/10 text-brand'
          }`}
        >
          {suspended && 'Suspended'}
          {!suspended && (
          entitlement.isPremium
            ? entitlement.cancelAtPeriodEnd
              ? 'Premium · cancelling'
              : 'Premium'
            : 'Free reader'
          )}
        </span>
      </header>

      <Section
        title="Account status"
        subtitle={suspended ? 'This reader cannot sign in' : 'Active'}
      >
        <div className="px-4 py-4">
          <p className="text-sm text-muted">
            {suspended
              ? 'Reinstating restores sign-in immediately. A reason is recorded either way.'
              : 'Suspending signs this reader out everywhere and blocks new sign-ins. Their comments stay visible.'}
          </p>

          <label className="mt-3 block">
            <span className="mb-1.5 block text-sm font-medium">
              Reason <span className="text-muted">(required, recorded against your name)</span>
            </span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              maxLength={500}
              placeholder={
                suspended
                  ? 'e.g. Appeal upheld — suspension issued in error'
                  : 'e.g. Repeated abusive comments after warning'
              }
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/25"
            />
          </label>

          {actionError && (
            <p className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {actionError}
            </p>
          )}

          <button
            type="button"
            // Guarded here as well as server-side so the button cannot be
            // pressed without a reason at all.
            disabled={working || reason.trim().length < 5}
            onClick={() => changeStatus(suspended ? 'REINSTATE' : 'SUSPEND')}
            className={`mt-3 rounded-lg px-3 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
              suspended ? 'bg-success hover:opacity-90' : 'bg-danger hover:opacity-90'
            }`}
          >
            {working
              ? 'Saving…'
              : suspended
                ? 'Reinstate account'
                : 'Suspend account'}
          </button>
        </div>
      </Section>

      <Section title="Profile">
        <Row label="Name" value={reader.displayName ?? '—'} />
        <Row
          label="Profile picture"
          value={reader.avatarSrc ? (reader.avatarUrl ? 'external link' : 'uploaded') : 'none'}
        />
        <Row
          label="Email"
          value={
            reader.email ? (
              <>
                {reader.email}
                <Tag ok={reader.emailVerified}>
                  {reader.emailVerified ? 'verified' : 'unverified'}
                </Tag>
              </>
            ) : (
              '—'
            )
          }
        />
        <Row
          label="Phone"
          value={
            reader.phone ? (
              <>
                {reader.phone}
                <Tag ok={reader.phoneVerified}>
                  {reader.phoneVerified ? 'verified' : 'unverified'}
                </Tag>
              </>
            ) : (
              '—'
            )
          }
        />
        <Row
          label="Contact phone"
          value={
            reader.contactPhone ? (
              <>
                {reader.contactPhone}
                {/* Distinct from the verified sign-in number above. */}
                <span className="ml-2 text-xs text-muted">profile</span>
              </>
            ) : (
              '—'
            )
          }
        />
        <Row
          label="Location"
          value={
            [reader.city, reader.state, reader.country].filter(Boolean).join(', ') || '—'
          }
        />
        <Row label="Bio" value={reader.bio ?? '—'} />
        <Row label="Date of birth" value={formatDate(reader.dateOfBirth)} />
        <Row
          label="Locale / timezone"
          value={`${reader.locale}${reader.timezone ? ` · ${reader.timezone}` : ''}`}
        />
        <Row
          label="Preferred topics"
          value={reader.preferredTopics.length ? reader.preferredTopics.join(', ') : '—'}
        />
        <Row label="Briefing digest" value={reader.digestFrequency.toLowerCase()} />
        <Row
          label="Notifications"
          value={
            [
              reader.notifications.breakingNews && 'breaking',
              reader.notifications.newsletter && 'newsletter',
              reader.notifications.productNews && 'product',
            ]
              .filter(Boolean)
              .join(', ') || 'all off'
          }
        />
        <Row label="Sign-in methods" value={methods.length ? methods.join(', ') : 'none'} />
        <Row label="Reader ID" value={<code className="text-xs">{reader.id}</code>} />
      </Section>

      <Section title="Subscription">
        {subscription ? (
          <>
            <Row label="Plan" value={subscription.planKey} />
            <Row
              label="Status"
              value={
                <>
                  {subscription.status.toLowerCase()}
                  {/* The stored status can still read ACTIVE after the paid
                      period lapses; entitlement is what actually governs access. */}
                  {!entitlement.isPremium && subscription.status === 'ACTIVE' && (
                    <Tag ok={false}>lapsed</Tag>
                  )}
                </>
              }
            />
            <Row label="Billing period" value={subscription.period?.toLowerCase() ?? '—'} />
            <Row label="Started" value={formatDate(subscription.currentPeriodStart)} />
            <Row
              label={subscription.cancelAtPeriodEnd ? 'Access ends' : 'Renews'}
              value={
                <>
                  {formatDate(subscription.currentPeriodEnd)}
                  {entitlement.daysRemaining !== null && (
                    <span className="ml-2 text-xs text-muted">
                      ({entitlement.daysRemaining} days left)
                    </span>
                  )}
                </>
              }
            />
            {subscription.canceledAt && (
              <Row label="Cancelled on" value={formatDate(subscription.canceledAt)} />
            )}
            {subscription.grantedByUserId && (
              <Row
                label="Complimentary"
                value={`Granted by staff${
                  subscription.grantNote ? ` — ${subscription.grantNote}` : ''
                }`}
              />
            )}
          </>
        ) : (
          <p className="px-4 py-6 text-sm text-muted">
            This reader has never subscribed.
          </p>
        )}
      </Section>

      <Section
        title="Billing"
        subtitle={`Lifetime ${money(billing.lifetimeValue, billing.currency)} · ${
          billing.paidCount
        } paid`}
      >
        {billing.invoices.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No invoices yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 font-medium text-muted">Date</th>
                  <th className="px-4 py-2.5 font-medium text-muted">Amount</th>
                  <th className="px-4 py-2.5 font-medium text-muted">Period</th>
                  <th className="px-4 py-2.5 font-medium text-muted">Status</th>
                  <th className="px-4 py-2.5 font-medium text-muted">Method</th>
                </tr>
              </thead>
              <tbody>
                {billing.invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 whitespace-nowrap text-muted">
                      {formatDate(invoice.paidAt ?? invoice.issuedAt)}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {money(invoice.amount, invoice.currency)}
                      {invoice.discountPercent ? (
                        <span className="ml-1.5 text-xs text-muted">
                          −{invoice.discountPercent}%
                          {invoice.promoCode ? ` ${invoice.promoCode}` : ''}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted">{invoice.period.toLowerCase()}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          invoice.status === 'PAID'
                            ? 'text-success'
                            : invoice.status === 'FAILED'
                              ? 'text-danger'
                              : 'text-muted'
                        }
                      >
                        {invoice.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{invoice.paymentMethod ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Engagement"
        subtitle={`${engagement.comments} comments · ${engagement.articleLikes} likes given · ${engagement.likesReceived} received`}
      >
        {engagement.recentComments.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">
            This reader has not commented yet.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {engagement.recentComments.map((comment) => (
              <div key={comment.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-xs text-muted">
                    {comment.isReply ? 'Reply on' : 'Comment on'}{' '}
                    <span className="font-medium text-foreground">
                      {comment.articleTitle ?? comment.articleId}
                    </span>
                  </span>
                  <span className="text-xs text-muted tabular-nums">
                    {formatDate(comment.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-sm break-words">{comment.body}</p>
                <div className="mt-1.5 flex gap-3 text-xs text-muted tabular-nums">
                  <span>{comment.likeCount} likes</span>
                  <span>{comment.replyCount} replies</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Moderation history"
        subtitle={accountActions.length ? `${accountActions.length} recorded` : undefined}
      >
        {accountActions.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">
            No staff action has been taken on this account.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {accountActions.map((entry) => (
              <div key={entry.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span
                    className={`text-sm font-semibold ${
                      entry.type === 'SUSPEND' ? 'text-danger' : 'text-success'
                    }`}
                  >
                    {entry.type === 'SUSPEND' ? 'Suspended' : 'Reinstated'}
                  </span>
                  <span className="text-xs text-muted tabular-nums">
                    {formatDateTime(entry.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-sm break-words">{entry.reason}</p>
                <p className="mt-1 text-xs text-muted">by {entry.actor.name}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Sign-in activity"
        subtitle={`${data.activeSessionCount} active now · last ${activity.length} shown`}
      >
        {activity.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No sign-ins recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 font-medium text-muted">Signed in</th>
                  <th className="px-4 py-2.5 font-medium text-muted">Device</th>
                  <th className="px-4 py-2.5 font-medium text-muted">IP</th>
                  <th className="px-4 py-2.5 font-medium text-muted">State</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((session) => (
                  <tr key={session.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 whitespace-nowrap text-muted">
                      {formatDateTime(session.signedInAt)}
                    </td>
                    <td className="px-4 py-3">{deviceLabel(session.userAgent)}</td>
                    <td className="px-4 py-3 tabular-nums text-muted">
                      {session.ip ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={session.active ? 'text-success' : 'text-muted'}>
                        {session.active
                          ? 'active'
                          : session.revokedAt
                            ? 'signed out'
                            : 'expired'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </main>
  );
}
