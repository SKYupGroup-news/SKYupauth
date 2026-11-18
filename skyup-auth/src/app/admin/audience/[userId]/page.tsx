import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/current-user';
import { ReaderDetail } from './reader-detail';

export const metadata = { title: 'Reader — SkyUp News' };

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Gated here and again in the API — the page is not the security boundary.
  if (user.role !== 'ADMIN') {
    return (
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Not available</h1>
        <p className="mt-2 text-sm text-muted">
          Reader profiles are limited to administrators.
        </p>
        <Link href="/account" className="mt-6 inline-block text-sm text-brand hover:underline">
          Back to your account
        </Link>
      </main>
    );
  }

  const { userId } = await params;
  return <ReaderDetail userId={userId} />;
}
