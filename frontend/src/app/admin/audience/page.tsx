import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/current-user';
import { AudienceExplorer } from './audience-client';

export const metadata = { title: 'Audience — SkyUp News' };

export default async function AudiencePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Gated in the UI and again in the API — the page is not the security boundary.
  if (user.role !== 'ADMIN') {
    return (
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Not available</h1>
        <p className="mt-2 text-sm text-muted">
          The audience view is limited to administrators.
        </p>
        <Link href="/account" className="mt-6 inline-block text-sm text-brand hover:underline">
          Back to your account
        </Link>
      </main>
    );
  }

  return <AudienceExplorer />;
}
