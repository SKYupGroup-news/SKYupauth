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
  admin_only: 'Audience customer accounts cannot sign in to this internal software. Access is restricted to staff administrators.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) {
    if (user.role === 'ADMIN') redirect('/admin/users');
    redirect('/login');
  }

  const { error } = await searchParams;

  return (
    <AuthShell
      title="SkyUp Auth — Internal Portal"
      subtitle="Administrative and identity console for internal staff."
    >
      <LoginForm
        providers={configuredProviders()}
        initialError={error ? (ERROR_MESSAGES[error] ?? 'Sign-in failed.') : undefined}
      />
    </AuthShell>
  );
}
