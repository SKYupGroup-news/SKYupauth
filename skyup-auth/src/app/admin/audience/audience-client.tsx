'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

type Filter = 'all' | 'premium' | 'free' | 'cancelling' | 'expiring';

interface Reader {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  avatarSrc: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  role: string;
  status: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  joinedAt: string;
  isPremium: boolean;
  plan: string | null;
  subscriptionStatus: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  daysRemaining: number | null;
  isComplimentary: boolean;
}

interface Payload {
  summary: {
    totalReaders: number;
    premium: number;
    free: number;
    cancelling: number;
    expiringThisMonth: number;
    monthEndsOn: string;
    collected: Array<{ currency: string; amountMinor: number }>;
  };
  regions: RegionFacet[];
  activeLocation: { country: string; state: string; city: string };
  page: number;
  total: number;
  totalPages: number;
  readers: Reader[];
}

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All readers' },
  { id: 'premium', label: 'Paid' },
  { id: 'free', label: 'Not paid' },
  { id: 'cancelling', label: 'Cancelling' },
  { id: 'expiring', label: 'Expiring this month' },
];

const numberFormat = new Intl.NumberFormat('en-US');

function money(currency: string, minor: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

function shortDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function initials(reader: Reader) {
  const source = reader.name || reader.email;

  // A phone-only reader has no letters to initialise, and "+" alone reads as
  // nothing — show the last two digits so rows stay tellable apart.
  if (!source) {
    const digits = (reader.phone ?? '').replace(/\D/g, '');
    return digits.slice(-2) || '?';
  }

  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

/** Status is never carried by color alone — every pill pairs a dot with a word. */
function StatusPill({ reader }: { reader: Reader }) {
  let tone = 'var(--viz-free)';
  let label = 'Free';

  if (reader.status !== 'ACTIVE') {
    tone = 'var(--status-critical)';
    label = reader.status === 'SUSPENDED' ? 'Suspended' : 'Deleted';
  } else if (reader.isPremium && reader.cancelAtPeriodEnd) {
    tone = 'var(--status-warning)';
    label = 'Cancelling';
  } else if (reader.isPremium) {
    tone = 'var(--status-good)';
    label = reader.isComplimentary ? 'Comp' : 'Paid';
  } else if (
    reader.subscriptionStatus !== 'NONE' &&
    // Covers the derived case too: a row can still say ACTIVE while its paid
    // period has already run out, and that reader has lapsed, not "never paid".
    (reader.currentPeriodEnd === null || new Date(reader.currentPeriodEnd) <= new Date())
  ) {
    tone = 'var(--viz-free)';
    label = 'Lapsed';
  }

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium">
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: tone }}
      />
      {label}
    </span>
  );
}

/**
 * Uploaded picture when there is one, initials otherwise. An image that fails
 * to load falls back to initials rather than leaving a broken box.
 */
function Avatar({ src, label }: { src: string | null; label: string }) {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={32}
        height={32}
        onError={() => setFailed(true)}
        className="h-8 w-8 shrink-0 rounded-full object-cover"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand/10 text-xs font-semibold text-brand"
    >
      {label}
    </span>
  );
}

function StatTile({
  label,
  value,
  hint,
  hero = false,
}: {
  label: string;
  value: string;
  hint?: string;
  hero?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface shadow-[var(--shadow-card)] px-4 py-3.5">
      <div className="text-xs font-medium tracking-wide text-muted uppercase">{label}</div>
      <div
        className={`mt-1 font-semibold tabular-nums ${hero ? 'text-4xl' : 'text-2xl'}`}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/**
 * Part-to-whole for two segments. Premium takes the accent hue and free takes
 * the de-emphasis gray, so the paying share is what the eye lands on. Both
 * segments are directly labelled, so the split is readable without the colors.
 */
function SplitBar({ premium, free }: { premium: number; free: number }) {
  const total = premium + free;
  if (total === 0) return null;

  const premiumPct = (premium / total) * 100;

  return (
    <div className="rounded-xl border border-border bg-surface shadow-[var(--shadow-card)] px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-muted uppercase">
          Paid share of audience
        </span>
        <span className="text-sm font-semibold tabular-nums">
          {premiumPct.toFixed(premiumPct < 10 ? 1 : 0)}%
        </span>
      </div>

      <div
        className="mt-2.5 flex h-3 w-full gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label={`${premium} paid of ${total} readers, ${free} not paid`}
      >
        <div
          style={{ width: `${premiumPct}%`, background: 'var(--viz-premium)' }}
          className="h-full rounded-l-full"
          title={`Paid: ${numberFormat.format(premium)}`}
        />
        <div
          style={{ width: `${100 - premiumPct}%`, background: 'var(--viz-free)' }}
          className="h-full rounded-r-full"
          title={`Not paid: ${numberFormat.format(free)}`}
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full"
            style={{ background: 'var(--viz-premium)' }}
          />
          Paid {numberFormat.format(premium)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full"
            style={{ background: 'var(--viz-free)' }}
          />
          Not paid {numberFormat.format(free)}
        </span>
      </div>
    </div>
  );
}

const NO_LOCATION = '__none__';

interface CityFacet {
  value: string;
  label: string;
  count: number;
}

interface StateFacet {
  value: string;
  label: string;
  count: number;
  cities: CityFacet[];
}

interface RegionFacet {
  value: string;
  label: string;
  count: number;
  states?: StateFacet[];
  cities: CityFacet[];
}

export function AudienceExplorer() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [country, setCountry] = useState('');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Rows accumulate across pages instead of being replaced, so "Show more"
  // extends the list rather than navigating away from what is already loaded.
  const [rows, setRows] = useState<Reader[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  // Set only by "Show more"; every other refetch replaces the list.
  const appendRef = useRef(false);

  // EMS Import Modal State
  const [showEmsModal, setShowEmsModal] = useState(false);
  const [emsApiUrl, setEmsApiUrl] = useState('http://localhost:4000/api/integration');
  const [emsApiKey, setEmsApiKey] = useState('');
  const [emsRole, setEmsRole] = useState<'READER' | 'EDITOR' | 'ADMIN'>('READER');
  const [emsPassword, setEmsPassword] = useState('password123');
  const [emsDepartment, setEmsDepartment] = useState('');
  const [emsPulling, setEmsPulling] = useState(false);
  const [emsResult, setEmsResult] = useState<{
    ok: boolean;
    message: string;
    createdCount?: number;
    updatedCount?: number;
    fetchedCount?: number;
    workspace?: string;
  } | null>(null);

  async function handleImportEms(e: React.FormEvent) {
    e.preventDefault();
    setEmsPulling(true);
    setEmsResult(null);

    try {
      const response = await fetch('/api/admin/integration/ems/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiUrl: emsApiUrl,
          apiKey: emsApiKey,
          defaultRole: emsRole,
          defaultPassword: emsPassword,
          departmentFilter: emsDepartment,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? 'Failed to import users from EMS API.');
      }

      setEmsResult({
        ok: true,
        message: payload.message || 'Users imported successfully into SkyUp Auth.',
        createdCount: payload.createdCount,
        updatedCount: payload.updatedCount,
        fetchedCount: payload.fetchedCount,
        workspace: payload.workspace,
      });

      // Refetch audience data to immediately reflect imported users in the table
      setPage(1);
      setLoading(true);
      const params = new URLSearchParams({ filter, page: '1' });
      if (debounced) params.set('q', debounced);
      if (country) params.set('country', country);
      if (state) params.set('state', state);
      if (city) params.set('city', city);
      const refreshRes = await fetch(`/api/admin/audience?${params}`);
      if (refreshRes.ok) {
        const next = (await refreshRes.json()) as Payload;
        setData(next);
        setRows(next.readers);
      }
    } catch (err: unknown) {
      setEmsResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Unknown error during EMS import.',
      });
    } finally {
      setEmsPulling(false);
    }
  }

  // Debounced so typing does not fire a query per keystroke. Bails out when the
  // trimmed term is unchanged — otherwise the very first run would raise the
  // loading flag without causing a refetch to lower it again.
  useEffect(() => {
    const next = search.trim();
    if (next === debounced) return;

    const timer = setTimeout(() => {
      setDebounced(next);
      setPage(1);
      setLoading(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, debounced]);

  useEffect(() => {
    let cancelled = false;

    const params = new URLSearchParams({ filter, page: String(page) });
    if (debounced) params.set('q', debounced);
    if (country) params.set('country', country);
    if (state) params.set('state', state);
    if (city) params.set('city', city);

    fetch(`/api/admin/audience?${params}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error?.message ?? 'Could not load readers.');
        }
        if (!cancelled) {
          const next = payload as Payload;
          // Read the flag now, not inside the updater: React evaluates a
          // functional update during the following render, by which point
          // `finally` has already cleared it and every page would replace
          // the list instead of extending it.
          const shouldAppend = appendRef.current;
          setData(next);
          if (country && state) {
            setRows((prev) => (shouldAppend ? [...prev, ...next.readers] : next.readers));
          } else {
            setRows([]);
          }
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Could not load readers.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setLoadingMore(false);
          appendRef.current = false;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filter, page, debounced, country, state, city]);

  async function grant(reader: Reader) {
    setBusyId(reader.id);
    try {
      const response = await fetch('/api/admin/subscription/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: reader.id,
          period: 'ANNUAL',
          note: 'Granted from the audience view',
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? 'Could not grant Premium.');
      }
      const payload = await response.json();
      const granted = payload?.entitlement;

      // Patch just this row and nudge the totals, rather than refetching — a
      // reload would discard every page the admin has already loaded.
      setRows((prev) =>
        prev.map((row) =>
          row.id === reader.id
            ? {
                ...row,
                isPremium: Boolean(granted?.isPremium),
                plan: granted?.period ?? row.plan,
                subscriptionStatus: granted?.status ?? row.subscriptionStatus,
                currentPeriodEnd: granted?.currentPeriodEnd ?? row.currentPeriodEnd,
                cancelAtPeriodEnd: Boolean(granted?.cancelAtPeriodEnd),
                daysRemaining: granted?.daysRemaining ?? row.daysRemaining,
                isComplimentary: true,
              }
            : row,
        ),
      );

      // The button only shows for non-paying readers, so this always moves one
      // reader from "not paid" to "paid".
      setData((prev) =>
        prev
          ? {
              ...prev,
              summary: {
                ...prev.summary,
                premium: prev.summary.premium + 1,
                free: Math.max(0, prev.summary.free - 1),
              },
            }
          : prev,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not grant Premium.');
    } finally {
      setBusyId(null);
    }
  }

  const summary = data?.summary;
  const monthEndLabel = summary?.monthEndsOn
    ? new Date(summary.monthEndsOn).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
      })
    : '';
  // Server page size; kept in step with PAGE_SIZE in the audience API.
  const PAGE_SIZE = 25;
  const remaining = Math.max(0, (data?.total ?? 0) - rows.length);
  const hasMore = remaining > 0;
  const regions = useMemo(() => data?.regions ?? [], [data]);

  // States narrow to the chosen country; with no country chosen, all states are offered
  const stateOptions = useMemo(() => {
    if (country) {
      return regions.find((region) => region.value === country)?.states ?? [];
    }

    const merged = new Map<string, StateFacet>();
    for (const region of regions) {
      for (const option of region.states ?? []) {
        const existing = merged.get(option.value);
        merged.set(
          option.value,
          existing
            ? { ...existing, count: existing.count + option.count }
            : { ...option },
        );
      }
    }
    return [...merged.values()].sort((a, b) =>
      a.value === NO_LOCATION ? 1 : b.value === NO_LOCATION ? -1 : b.count - a.count,
    );
  }, [regions, country]);

  // Cities narrow to the chosen state or region; with none chosen, every city is offered
  const cityOptions = useMemo(() => {
    if (country && state) {
      const reg = regions.find((r) => r.value === country);
      const st = reg?.states?.find((s) => s.value === state);
      if (st?.cities) return st.cities;
    }
    if (state) {
      const merged = new Map<string, CityFacet>();
      for (const region of regions) {
        const st = region.states?.find((s) => s.value === state);
        for (const option of st?.cities ?? []) {
          const existing = merged.get(option.value);
          merged.set(
            option.value,
            existing
              ? { ...existing, count: existing.count + option.count }
              : { ...option },
          );
        }
      }
      return [...merged.values()].sort((a, b) =>
        a.value === NO_LOCATION ? 1 : b.value === NO_LOCATION ? -1 : b.count - a.count,
      );
    }
    if (country) {
      return regions.find((region) => region.value === country)?.cities ?? [];
    }

    const merged = new Map<string, CityFacet>();
    for (const region of regions) {
      for (const option of region.cities) {
        const existing = merged.get(option.value);
        merged.set(
          option.value,
          existing
            ? { ...existing, count: existing.count + option.count }
            : { ...option },
        );
      }
    }
    return [...merged.values()].sort((a, b) =>
      a.value === NO_LOCATION ? 1 : b.value === NO_LOCATION ? -1 : b.count - a.count,
    );
  }, [regions, country, state]);
  const collectedLabel = useMemo(() => {
    if (!summary?.collected.length) return '—';
    return summary.collected.map((row) => money(row.currency, row.amountMinor)).join(' · ');
  }, [summary]);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audience</h1>
          <p className="mt-1 text-sm text-muted">
            Every reader, and whether they are paying.
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/users"
            className="rounded-lg border border-brand bg-brand px-3 py-2 text-sm font-semibold text-brand-contrast transition hover:bg-brand-strong shadow-sm"
          >
            👥 Audience Profiles
          </Link>
          <Link
            href="/admin/comments"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium hover:border-brand/50"
          >
            Comments
          </Link>
          <Link
            href="/account"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium hover:border-brand/50"
          >
            Back to account
          </Link>
        </span>
      </div>

      {/* KPI row — headline numbers are stat tiles, not a chart. */}
      <section className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label="Total readers"
          value={summary ? numberFormat.format(summary.totalReaders) : '—'}
          hero
        />
        <StatTile
          label="Paid"
          value={summary ? numberFormat.format(summary.premium) : '—'}
          hint={summary ? `${numberFormat.format(summary.cancelling)} cancelling` : undefined}
        />
        <StatTile
          label="Not paid"
          value={summary ? numberFormat.format(summary.free) : '—'}
        />
        <StatTile
          label="Expiring this month"
          value={summary ? numberFormat.format(summary.expiringThisMonth) : '—'}
          hint={summary ? `by ${monthEndLabel}` : undefined}
        />
        <StatTile label="Collected" value={collectedLabel} hint="Lifetime, paid invoices" />
      </section>

      <section className="mt-3">
        {summary && <SplitBar premium={summary.premium} free={summary.free} />}
      </section>

      {/* Filters in one row above the data. */}
      <section className="mt-6 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setFilter(option.id);
                setPage(1);
                setLoading(true);
              }}
              aria-pressed={filter === option.id}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                filter === option.id
                  ? 'bg-brand text-brand-contrast'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, email, phone or place"
          aria-label="Search readers"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/25 sm:max-w-xs"
        />
      </section>

      {/* Dedicated Location Filter (Country 1st -> State 2nd) */}
      <section className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted">
            <span>📍 Location Filter:</span>
          </span>

          {/* 1. Country */}
          <div className="flex items-center gap-2">
            <label htmlFor="audience-country-select" className="text-xs font-medium text-foreground">
              1. Country:
            </label>
            <select
              id="audience-country-select"
              value={country}
              aria-label="Filter by country (1st)"
              onChange={(event) => {
                setCountry(event.target.value);
                setState('');
                setCity('');
                setPage(1);
                setLoading(true);
              }}
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm focus:border-brand focus:outline-none"
            >
              <option value="">— Select Country (1st) —</option>
              {regions.map((region) => (
                <option key={region.value} value={region.value}>
                  {region.label} ({numberFormat.format(region.count)})
                </option>
              ))}
            </select>
          </div>

          {/* 2. State */}
          <div className="flex items-center gap-2">
            <label htmlFor="audience-state-select" className="text-xs font-medium text-foreground">
              2. State:
            </label>
            <select
              id="audience-state-select"
              value={state}
              aria-label="Filter by state (2nd)"
              disabled={!country}
              onChange={(event) => {
                setState(event.target.value);
                setCity('');
                setPage(1);
                setLoading(true);
              }}
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm focus:border-brand focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">
                {!country ? 'Select Country First' : '— Select State (2nd) —'}
              </option>
              {stateOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({numberFormat.format(option.count)})
                </option>
              ))}
            </select>
          </div>

          {/* Optional City */}
          {country && state && cityOptions.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="audience-city-select" className="text-xs font-medium text-muted">
                City:
              </label>
              <select
                id="audience-city-select"
                value={city}
                aria-label="Filter by city"
                onChange={(event) => {
                  setCity(event.target.value);
                  setPage(1);
                  setLoading(true);
                }}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm focus:border-brand focus:outline-none"
              >
                <option value="">All cities</option>
                {cityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({numberFormat.format(option.count)})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Clear Location Button */}
          {(country || state || city) && (
            <button
              type="button"
              onClick={() => {
                setCountry('');
                setState('');
                setCity('');
                setPage(1);
                setLoading(true);
              }}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-danger hover:text-danger hover:bg-danger/5 shadow-sm"
            >
              <span>✕</span>
              <span className="font-semibold">Clear Location</span>
            </button>
          )}
        </div>

        {country && state && (
          <div className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
            <span>Territory:</span>
            <span>{state}, {country}</span>
          </div>
        )}
      </section>

      {error && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
        >
          {error}
        </p>
      )}

      {/* Table scrolls on its own so the page never scrolls sideways. */}
      <section className="mt-4 overflow-x-auto rounded-xl border border-border shadow-[var(--shadow-card)]">
        <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className="px-4 py-2.5 font-medium text-muted">Reader</th>
              <th className="px-4 py-2.5 font-medium text-muted">Contact</th>
              <th className="px-4 py-2.5 font-medium text-muted">Location</th>
              <th className="px-4 py-2.5 font-medium text-muted">Status</th>
              <th className="px-4 py-2.5 font-medium text-muted">Plan</th>
              <th className="px-4 py-2.5 font-medium text-muted">Renews / ends</th>
              <th className="px-4 py-2.5 font-medium text-muted">Joined</th>
              <th className="px-4 py-2.5 font-medium text-muted"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {!country || !state ? (
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center">
                  <div className="mx-auto flex max-w-sm flex-col items-center justify-center text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-xl text-brand">
                      📍
                    </div>
                    <h3 className="mt-3 text-base font-semibold text-foreground">
                      {!country ? 'Step 1: Select Country' : 'Step 2: Select State'}
                    </h3>
                    <p className="mt-1 text-xs text-muted">
                      {!country
                        ? 'Please choose a country from the filter above to begin browsing subscribers.'
                        : `Selected country: ${country}. Now select a state to display subscriber records.`}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              <>
                {loading && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-muted">
                      Loading readers…
                    </td>
                  </tr>
                )}

                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-muted">
                      No readers match this view.
                    </td>
                  </tr>
                )}

                {!loading &&
                  rows.map((reader) => (
                    <tr key={reader.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar src={reader.avatarSrc} label={initials(reader)} />
                          <div className="min-w-0">
                            <Link
                              href={`/admin/audience/${reader.id}`}
                              className="block truncate font-medium hover:text-brand hover:underline"
                            >
                              {reader.name ?? 'Unnamed reader'}
                            </Link>
                            {reader.role !== 'READER' && (
                              <div className="text-xs text-muted">{reader.role.toLowerCase()}</div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="truncate">{reader.email ?? reader.phone ?? '—'}</div>
                        <div className="text-xs text-muted">
                          {reader.email && !reader.emailVerified && 'email unverified'}
                          {reader.email && reader.emailVerified && reader.phone && reader.phone}
                          {!reader.email && reader.phone && 'phone only'}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        {reader.city || reader.state || reader.country ? (
                          <>
                            <div className="truncate">{reader.city ?? reader.state ?? reader.country}</div>
                            {(reader.state || reader.country) && (
                              <div className="text-xs text-muted">
                                {[reader.state, reader.country].filter(Boolean).filter(v => v !== (reader.city ?? reader.state)).join(', ')}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>

                      <td className="px-4 py-3"><StatusPill reader={reader} /></td>

                      <td className="px-4 py-3 text-muted">
                        {reader.isPremium
                          ? reader.plan === 'ANNUAL'
                            ? 'Premium annual'
                            : 'Premium monthly'
                          : '—'}
                      </td>

                      <td className="px-4 py-3 tabular-nums text-muted">
                        {reader.isPremium ? (
                          <>
                            {shortDate(reader.currentPeriodEnd)}
                            {reader.daysRemaining !== null && (
                              <span className="block text-xs">
                                {reader.daysRemaining} days left
                              </span>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>

                      <td className="px-4 py-3 tabular-nums text-muted">
                        {shortDate(reader.joinedAt)}
                      </td>

                      <td className="px-4 py-3 text-right">
                        {!reader.isPremium && reader.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() => grant(reader)}
                            disabled={busyId === reader.id}
                            className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition hover:border-brand/50 disabled:opacity-60"
                          >
                            {busyId === reader.id ? 'Granting…' : 'Grant Premium'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </>
            )}
          </tbody>
        </table>
      </section>

      {data && (
        <nav className="mt-4 flex flex-col items-center gap-2 text-sm">
          {country && state ? (
            <>
              {hasMore ? (
                <button
                  type="button"
                  onClick={() => {
                    appendRef.current = true;
                    setLoadingMore(true);
                    setPage((current) => current + 1);
                  }}
                  disabled={loadingMore}
                  className="rounded-lg border border-border bg-surface px-4 py-2 font-medium transition hover:border-brand/50 disabled:opacity-50"
                >
                  {loadingMore
                    ? 'Loading…'
                    : `Show ${numberFormat.format(Math.min(PAGE_SIZE, remaining))} more`}
                </button>
              ) : (
                rows.length > 0 && (
                  <span className="text-muted">That is everyone.</span>
                )
              )}

              <span className="text-muted">
                Showing {numberFormat.format(rows.length)} of {numberFormat.format(data.total)}{' '}
                {data.total === 1 ? 'reader' : 'readers'} in{' '}
                <strong className="text-brand">{state}, {country}</strong>
              </span>
            </>
          ) : (
            <span className="text-xs text-muted italic">
              Select Country & State to view records
            </span>
          )}
        </nav>
      )}

      {/* EMS API Import Modal */}
      {showEmsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand text-xs font-bold text-brand-contrast">
                    ⚡
                  </span>
                  <h2 className="text-lg font-bold text-foreground">Import Users via EMS API</h2>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Connect to external EMS API using a Scoped API Key to pull employee records directly into SkyUp Auth.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowEmsModal(false)}
                className="rounded-lg p-1 text-muted hover:bg-background hover:text-foreground"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleImportEms} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
                  EMS API Endpoint URL
                </label>
                <input
                  type="url"
                  required
                  value={emsApiUrl}
                  onChange={(e) => setEmsApiUrl(e.target.value)}
                  placeholder="http://localhost:4000/api/integration"
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
                  Scoped API Key <span className="text-danger">*</span>
                </label>
                <input
                  type="password"
                  required
                  value={emsApiKey}
                  onChange={(e) => setEmsApiKey(e.target.value)}
                  placeholder="Paste EMS API key with employee.read scope"
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus:border-brand focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
                    Assigned Role
                  </label>
                  <select
                    value={emsRole}
                    onChange={(e) => setEmsRole(e.target.value as 'READER' | 'EDITOR' | 'ADMIN')}
                    className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground focus:border-brand focus:outline-none"
                  >
                    <option value="READER">READER</option>
                    <option value="EDITOR">EDITOR</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
                    Default Password
                  </label>
                  <input
                    type="text"
                    required
                    value={emsPassword}
                    onChange={(e) => setEmsPassword(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus:border-brand focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
                  Department Filter (Optional)
                </label>
                <input
                  type="text"
                  value={emsDepartment}
                  onChange={(e) => setEmsDepartment(e.target.value)}
                  placeholder="e.g. Engineering, Sales (leave blank for all)"
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
                />
              </div>

              {emsResult && (
                <div
                  className={`rounded-xl border p-3.5 text-xs ${
                    emsResult.ok
                      ? 'border-success/30 bg-success/10 text-success'
                      : 'border-danger/30 bg-danger/10 text-danger'
                  }`}
                >
                  <p className="font-semibold">{emsResult.ok ? '✓ Import Successful' : '✗ Import Failed'}</p>
                  <p className="mt-1">{emsResult.message}</p>
                  {emsResult.ok && (
                    <div className="mt-2 flex gap-4 text-[11px] font-medium text-foreground">
                      <span>Fetched: <strong>{emsResult.fetchedCount ?? 0}</strong></span>
                      <span>Created: <strong>{emsResult.createdCount ?? 0}</strong></span>
                      <span>Updated: <strong>{emsResult.updatedCount ?? 0}</strong></span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEmsModal(false)}
                  className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-surface"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={emsPulling || !emsApiKey.trim()}
                  className="inline-flex items-center gap-2 rounded-lg border border-brand bg-brand px-4 py-2 text-sm font-semibold text-brand-contrast transition hover:bg-brand-strong disabled:opacity-50"
                >
                  {emsPulling ? 'Importing…' : 'Pull & Import Employees'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
