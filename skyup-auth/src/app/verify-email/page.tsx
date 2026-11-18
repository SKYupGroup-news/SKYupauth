'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Alert, AuthShell } from '@/components/ui';
import { apiPost } from '@/lib/api-client';

function TokenVerifier({ token }: { token: string }) {
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [message, setMessage] = useState('Confirming your email…');
  // Tokens are single-use, so React's development double-effect must not
  // consume the token twice and report a false failure.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    apiPost('/api/auth/verify-email', { token })
      .then(() => {
        setState('done');
        setMessage('Your email is confirmed. Thanks!');
      })
      .catch((cause: unknown) => {
        setState('failed');
        setMessage(cause instanceof Error ? cause.message : 'We could not confirm that link.');
      });
  }, [token]);

  if (state === 'working') return <p className="text-sm text-muted">{message}</p>;
  return <Alert kind={state === 'done' ? 'success' : 'error'}>{message}</Alert>;
}

function Verifier() {
  const token = useSearchParams().get('token');

  // Derived during render rather than in an effect — there is nothing to sync.
  if (!token) {
    return <Alert kind="error">This confirmation link is incomplete.</Alert>;
  }

  return <TokenVerifier token={token} />;
}

export default function VerifyEmailPage() {
  return (
    <AuthShell
      title="Email confirmation"
      footer={
        <Link href="/account" className="hover:underline">
          Go to your account
        </Link>
      }
    >
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <Verifier />
      </Suspense>
    </AuthShell>
  );
}
