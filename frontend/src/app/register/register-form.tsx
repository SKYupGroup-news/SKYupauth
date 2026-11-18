'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Field } from '@/components/ui';
import { apiPost } from '@/lib/api-client';

export function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setPending(true);
        setError(null);
        try {
          await apiPost('/api/auth/register', {
            displayName: data.get('displayName') || undefined,
            email: data.get('email'),
            password: data.get('password'),
          });
          router.push('/account');
          router.refresh();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Something went wrong.');
        } finally {
          setPending(false);
        }
      }}
    >
      {error && <Alert kind="error">{error}</Alert>}

      <Field label="Name" name="displayName" autoComplete="name" placeholder="Optional" />
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint="At least 10 characters."
      />

      <Button disabled={pending}>{pending ? 'Creating account…' : 'Create account'}</Button>
    </form>
  );
}
