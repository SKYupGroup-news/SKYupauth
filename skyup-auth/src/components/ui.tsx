import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center gap-3 text-lg font-semibold">
          <img src="/logo.png" alt="SkyUp Group" className="h-9 w-9 rounded-lg object-contain shadow-sm" />
          <span>SkyUp News</span>
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}

        <div className="mt-7">{children}</div>

        {footer && <div className="mt-6 text-sm text-muted">{footer}</div>}
      </div>
    </main>
  );
}

export function Field({
  label,
  hint,
  ...props
}: ComponentProps<'input'> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        {...props}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/25"
      />
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Button({
  variant = 'primary',
  ...props
}: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' }) {
  const styles =
    variant === 'primary'
      ? 'bg-brand text-brand-contrast hover:bg-brand-strong'
      : 'border border-border bg-surface hover:border-brand/50';

  return (
    <button
      {...props}
      className={`w-full rounded-lg px-3 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${styles}`}
    />
  );
}

export function Alert({ kind, children }: { kind: 'error' | 'success'; children: ReactNode }) {
  const tone =
    kind === 'error'
      ? 'border-danger/30 bg-danger/10 text-danger'
      : 'border-success/30 bg-success/10 text-success';

  return (
    <p role="status" className={`rounded-lg border px-3 py-2.5 text-sm ${tone}`}>
      {children}
    </p>
  );
}

export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      <span className="h-px flex-1 bg-border" />
      {children}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
