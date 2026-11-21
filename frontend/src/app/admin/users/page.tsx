import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/current-user';
import { UsersClient } from './users-client';

export const metadata = {
  title: 'Audience Customer Profiles — SkyUp News',
  description: 'Manage audience customer profiles, verification status, and credentials for the news project.',
};

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  if (user.role !== 'ADMIN') {
    return (
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Access Restricted</h1>
        <p className="mt-2 text-sm text-muted">
          This is an internal administration software. Audience customer accounts cannot access or sign in to this portal.
        </p>
        <a
          href="https://skyupnews.com"
          className="mt-6 inline-block rounded-lg border border-brand bg-brand px-4 py-2.5 text-sm font-semibold text-brand-contrast shadow-sm transition hover:bg-brand-strong"
        >
          &rarr; Go to SkyUp News (https://skyupnews.com)
        </a>
      </main>
    );
  }

  return <UsersClient currentAdminId={user.id} />;
}
