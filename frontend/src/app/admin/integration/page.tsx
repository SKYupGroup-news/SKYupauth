import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/current-user';
import { IntegrationClient } from './integration-client';

export const metadata = {
  title: 'API Integration Hub — SkyUp News',
  description: 'External API connectors, EMS employee synchronization, and microservice integration.',
};

export default async function IntegrationPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Strict Admin RBAC: Only primary administrator (admin@skyupnews.com) can access API integration
  if (user.role !== 'ADMIN' || user.email !== 'admin@skyupnews.com') {
    return (
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-danger/10 text-2xl text-danger shadow-sm">
          🔒
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">Access Restricted</h1>
        <p className="mt-2 text-sm text-muted">
          Only the primary administrator (<span className="font-mono text-foreground">admin@skyupnews.com</span>) has authorization to configure and execute API integrations.
        </p>
        <Link
          href="/admin/users"
          className="mt-6 inline-block rounded-lg border border-brand bg-brand px-4 py-2.5 text-sm font-semibold text-brand-contrast shadow-sm transition hover:bg-brand-strong"
        >
          &larr; Back to Admin Console
        </Link>
      </main>
    );
  }

  return <IntegrationClient userEmail={user.email} />;
}

