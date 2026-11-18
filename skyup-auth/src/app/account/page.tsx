import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/current-user';
import { SignOutButton } from './sign-out-button';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  );
}

function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
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

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'ADMIN') redirect('http://localhost:3000');

  const [activeSessions, linkedAccounts] = await Promise.all([
    prisma.session.count({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    }),
    prisma.oAuthAccount.findMany({
      where: { userId: user.id },
      select: { provider: true },
    }),
  ]);

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Your account</h1>
      <p className="mt-1.5 text-sm text-muted">
        Signed in as {user.displayName ?? user.email ?? user.phone}.
      </p>

      <div className="mt-8 rounded-xl border border-border bg-surface shadow-[var(--shadow-card)] px-4">
        <Row label="Name" value={user.displayName ?? '—'} />
        <Row
          label="Email"
          value={
            user.email ? (
              <>
                {user.email}
                <Badge ok={user.emailVerified}>
                  {user.emailVerified ? 'verified' : 'unverified'}
                </Badge>
              </>
            ) : (
              '—'
            )
          }
        />
        <Row
          label="Phone"
          value={
            user.phone ? (
              <>
                {user.phone}
                <Badge ok={user.phoneVerified}>
                  {user.phoneVerified ? 'verified' : 'unverified'}
                </Badge>
              </>
            ) : (
              '—'
            )
          }
        />
        <Row label="Role" value={user.role.toLowerCase()} />
        <Row
          label="Linked sign-ins"
          value={
            linkedAccounts.length
              ? linkedAccounts.map((a) => a.provider).join(', ')
              : 'none'
          }
        />
        <Row label="Active sessions" value={activeSessions} />
        <Row
          label="Member since"
          value={user.createdAt.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        />
      </div>

      {user.role === 'ADMIN' && (
        <div className="mt-6 space-y-2">
          {[
            { href: '/admin/users', label: 'Audience Customer Profiles' },
            { href: '/admin/audience', label: 'Subscribers' },
            { href: '/admin/comments', label: 'Comment moderation' },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium shadow-[var(--shadow-card)] transition hover:border-brand/50"
            >
              {item.label}
              <span aria-hidden="true" className="text-muted">
                &rarr;
              </span>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-6">
        <SignOutButton />
      </div>
    </main>
  );
}
