'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, AuthShell, Button, Field } from '@/components/ui';
import { apiPost } from '@/lib/api-client';

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  if (!token) {
    return <Alert kind="error">This reset link is incomplete. Request a new one.</Alert>;
  }

  if (done) {
    return (
      <Alert kind="success">
        Password updated. You have been signed out everywhere — sign in with your new password.
      </Alert>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const password = String(data.get('password'));

        if (password !== String(data.get('confirm'))) {
          setError('Those passwords do not match.');
          return;
        }

        setPending(true);
        setError(null);
        try {
          await apiPost('/api/auth/password/reset', { token, password });
          setDone(true);
          setTimeout(() => router.push('/login'), 2500);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Something went wrong.');
        } finally {
          setPending(false);
        }
      }}
    >
      {error && <Alert kind="error">{error}</Alert>}
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint="At least 10 characters."
      />
      <Field
        label="Confirm password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
      />
      <Button disabled={pending}>{pending ? 'Updating…' : 'Update password'}</Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Choose a new password"
      footer={
        <Link href="/login" className="hover:underline">
          Back to sign in
        </Link>
      }
    >
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
