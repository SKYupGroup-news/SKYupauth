import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/current-user';
import { CommentModeration } from './comments-client';

export const metadata = { title: 'Comments — SkyUp News' };

export default async function CommentsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Gated here and again in the API — the page is not the security boundary.
  if (user.role !== 'ADMIN') {
    return (
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Not available</h1>
        <p className="mt-2 text-sm text-muted">
          Comment moderation is limited to administrators.
        </p>
        <Link href="/account" className="mt-6 inline-block text-sm text-brand hover:underline">
          Back to your account
        </Link>
      </main>
    );
  }

  return <CommentModeration />;
}
