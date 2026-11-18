'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Divider, Field } from '@/components/ui';
import { apiPost } from '@/lib/api-client';

type Mode = 'password' | 'phone';

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Continue with Google',
  github: 'Continue with GitHub',
};

export function LoginForm({
  providers,
  initialError,
}: {
  providers: string[];
  initialError?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('password');
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [pending, setPending] = useState(false);

  // Phone flow is two steps: request a code, then verify it.
  const [codeSent, setCodeSent] = useState(false);
  const [phone, setPhone] = useState('');

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    } finally {
      setPending(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setCodeSent(false);
  }

  return (
    <div className="space-y-5">
      {error && <Alert kind="error">{error}</Alert>}

      <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-surface p-1">
        {(['password', 'phone'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => switchMode(value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              mode === value ? 'bg-brand text-brand-contrast' : 'text-muted hover:text-foreground'
            }`}
          >
            {value === 'password' ? 'Email' : 'Phone'}
          </button>
        ))}
      </div>

      {mode === 'password' ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            run(async () => {
              await apiPost('/api/auth/login', {
                email: data.get('email'),
                password: data.get('password'),
                adminOnly: true,
              });
              router.push('/admin/users');
              router.refresh();
            });
          }}
        >
          <Field label="Email or Username" name="email" type="text" autoComplete="email" required />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <Button disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</Button>
        </form>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            run(async () => {
              if (!codeSent) {
                await apiPost('/api/auth/otp/request', { phone });
                setCodeSent(true);
                return;
              }
              await apiPost('/api/auth/otp/verify', { phone, code: data.get('code'), adminOnly: true });
              router.push('/admin/audience');
              router.refresh();
            });
          }}
        >
          <Field
            label="Phone number"
            name="phone"
            type="tel"
            autoComplete="tel"
            required
            readOnly={codeSent}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+919876543210"
            hint="Include your country code."
          />

          {codeSent && (
            <Field
              label="6-digit code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              autoFocus
              hint="The code expires in 5 minutes."
            />
          )}

          <Button disabled={pending}>
            {pending ? 'Working…' : codeSent ? 'Verify and sign in' : 'Send code'}
          </Button>

          {codeSent && (
            <button
              type="button"
              className="w-full text-center text-xs text-muted underline underline-offset-2"
              onClick={() => run(async () => {
                await apiPost('/api/auth/otp/request', { phone });
              })}
            >
              Resend code
            </button>
          )}
        </form>
      )}

      {providers.length > 0 && (
        <>
          <Divider>or</Divider>
          <div className="space-y-2">
            {providers.map((provider) => (
              <a key={provider} href={`/api/auth/oauth/${provider}`} className="block">
                <Button type="button" variant="secondary">
                  {PROVIDER_LABELS[provider] ?? `Continue with ${provider}`}
                </Button>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
