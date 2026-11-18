import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/current-user';
import { EmployeesClient } from './employees-client';

export const metadata = {
  title: 'Employee Directory & Staff — SkyUp News',
  description: 'Manage corporate employee roster, bureau assignments, department hierarchy, and identity credentials.',
};

export default async function EmployeesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Role Guard: Only administrators can view and manage corporate employee lists
  if (user.role !== 'ADMIN') {
    return (
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-danger/10 text-2xl text-danger shadow-sm">
          🔒
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">Access Restricted</h1>
        <p className="mt-2 text-sm text-muted">
          Only administrators have authorization to view the corporate employee roster and staff credentials.
        </p>
        <Link
          href="/account"
          className="mt-6 inline-block rounded-lg border border-brand bg-brand px-4 py-2.5 text-sm font-semibold text-brand-contrast shadow-sm transition hover:bg-brand-strong"
        >
          &larr; Back to My Account
        </Link>
      </main>
    );
  }

  return <EmployeesClient currentAdmin={user} />;
}
