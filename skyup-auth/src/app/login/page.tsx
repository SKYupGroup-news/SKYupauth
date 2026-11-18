import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/ui';
import { getCurrentUser } from '@/lib/current-user';
import { configuredProviders } from '@/lib/oauth';
import { LoginForm } from './login-form';

const ERROR_MESSAGES: Record<string, string> = {
  provider_denied: 'You cancelled the sign-in request.',
  invalid_state: 'That sign-in attempt expired. Please try again.',
  exchange_failed: 'We could not complete sign-in with that provider.',
  missing_code: 'That sign-in attempt was incomplete. Please try again.',
  unknown_provider: 'That sign-in provider is not supported.',
  account_suspended: 'This account has been suspended.',
  admin_only: 'Audience customer accounts cannot sign in to this internal software. Please sign in to the audience news project at http://localhost:3000.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) {
    if (user.role === 'ADMIN') redirect('/admin/users');
    redirect('http://localhost:3000');
  }

  const { error } = await searchParams;

  return (
    <AuthShell
      title="SkyUp Auth — Internal Portal"
      subtitle="Administrative and identity console for internal staff."
      footer={
        <div className="space-y-2 text-center text-xs text-muted">
          <p className="font-semibold text-foreground">Are you an audience customer or news reader?</p>
          <p>
            Customer profiles must sign in on the audience news platform:{' '}
            <a
              href="http://localhost:3000"
              className="font-medium text-brand underline hover:text-brand-strong"
            >
              http://localhost:3000
            </a>
          </p>
        </div>
      }
    >
      <LoginForm
        providers={configuredProviders()}
        initialError={error ? (ERROR_MESSAGES[error] ?? 'Sign-in failed.') : undefined}
      />
    </AuthShell>
  );
}
