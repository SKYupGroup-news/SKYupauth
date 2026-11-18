'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { apiPost } from '@/lib/api-client';

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        // Logout is idempotent server-side, so navigate away regardless.
        await apiPost('/api/auth/logout').catch(() => {});
        router.push('/login');
        router.refresh();
      }}
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
