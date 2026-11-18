'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

type Filter = 'all' | 'visible' | 'removed' | 'replies';

interface Author {
  id: string;
  name: string;
  avatarSrc: string | null;
}

interface CommentRow {
  id: string;
  body: string;
  deleted: boolean;
  deletedAt: string | null;
  author: Author;
  authorId: string;
  authorCountry: string | null;
  authorState: string | null;
  authorCity: string | null;
  authorStatus: string;
  articleId: string;
  articleTitle: string | null;
  articleLocation: string | null;
  isReply: boolean;
  parent: { id: string; author: Author; body: string | null } | null;
  likeCount: number;
  replyCount: number;
  createdAt: string;
}

interface Payload {
  summary: {
    total: number;
    visible: number;
    removed: number;
    replies: number;
    likes: number;
  };
  regions: RegionFacet[];
  newsLocations: CityFacet[];
  activeLocation: { country: string; state?: string; city: string; newsLocation: string };
  account: AccountFilter;
  page: number;
  total: number;
  totalPages: number;
  pageSize: number;
  comments: CommentRow[];
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

type AccountFilter = 'all' | 'paid' | 'free' | 'suspended';

const ACCOUNTS: Array<{ id: AccountFilter; label: string }> = [
  { id: 'all', label: 'Any account' },
  { id: 'paid', label: 'Paid' },
  { id: 'free', label: 'Not paid' },
  { id: 'suspended', label: 'Suspended' },
];

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'visible', label: 'Visible' },
  { id: 'removed', label: 'Removed' },
  { id: 'replies', label: 'Replies' },
];

const numberFormat = new Intl.NumberFormat('en-GB');

function formatWhen(value: string): string {
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

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
      {initials}
    </span>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3.5 shadow-[var(--shadow-card)]">
      <div className="text-xs font-medium tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function CommentModeration() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [account, setAccount] = useState<AccountFilter>('all');
  const [country, setCountry] = useState('');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [newsLocation, setNewsLocation] = useState('');
  const [data, setData] = useState<Payload | null>(null);
  const [rows, setRows] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<CommentRow | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const appendRef = useRef(false);

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
    const params = new URLSearchParams({ filter, page: String(page), account });
    if (debounced) params.set('q', debounced);
    if (country) params.set('country', country);
    if (state) params.set('state', state);
    if (city) params.set('city', city);
    if (newsLocation) params.set('newsLocation', newsLocation);

    fetch(`/api/admin/comments?${params}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error?.message ?? 'Could not load comments.');
        }
        if (!cancelled) {
          const next = payload as Payload;
          // Captured before queuing: React runs the updater on the next render,
          // by which point `finally` has cleared the ref.
          const shouldAppend = appendRef.current;
          setData(next);
          if (country && state) {
            setRows((prev) => (shouldAppend ? [...prev, ...next.comments] : next.comments));
          } else {
            setRows([]);
          }
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Could not load comments.');
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
  }, [filter, page, debounced, account, country, state, city, newsLocation]);

  const remaining = Math.max(0, (data?.total ?? 0) - rows.length);
  const hasMore = remaining > 0;
  const summary = data?.summary;
  const regions = useMemo(() => data?.regions ?? [], [data]);
  const newsLocations = useMemo(() => data?.newsLocations ?? [], [data]);

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

  // Cities narrow to the chosen state or country
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
          existing ? { ...existing, count: existing.count + option.count } : { ...option },
        );
      }
    }
    return [...merged.values()].sort((a, b) =>
      a.value === NO_LOCATION ? 1 : b.value === NO_LOCATION ? -1 : b.count - a.count,
    );
  }, [regions, country, state]);
  const pageSize = data?.pageSize ?? 25;

  async function moderate(row: CommentRow) {
    setBusyId(row.id);
    setError(null);
    try {
      const response = row.deleted
        ? await fetch(`/api/admin/comments/${row.id}/restore`, { method: 'POST' })
        : await fetch(`/api/comments/${row.id}`, { method: 'DELETE' });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? 'Could not update that comment.');
      }

      // Patch in place so loaded pages survive the action.
      setRows((prev) =>
        prev.map((item) =>
          item.id === row.id ? { ...item, deleted: !row.deleted } : item,
        ),
      );
      setData((prev) =>
        prev
          ? {
              ...prev,
              summary: {
                ...prev.summary,
                visible: prev.summary.visible + (row.deleted ? 1 : -1),
                removed: prev.summary.removed + (row.deleted ? -1 : 1),
              },
            }
          : prev,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update that comment.');
    } finally {
      setBusyId(null);
    }
  }

  async function handlePermanentDelete() {
    if (!permanentDeleteTarget) return;
    setDeleteSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/comments/${permanentDeleteTarget.id}`, {
        method: 'DELETE',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? 'Failed to permanently delete comment.');
      }

      const deletedRow = permanentDeleteTarget;
      setRows((prev) => prev.filter((r) => r.id !== deletedRow.id));
      setData((prev) =>
        prev
          ? {
              ...prev,
              total: Math.max(0, prev.total - 1),
              summary: {
                ...prev.summary,
                total: Math.max(0, prev.summary.total - 1),
                visible: deletedRow.deleted ? prev.summary.visible : Math.max(0, prev.summary.visible - 1),
                removed: deletedRow.deleted ? Math.max(0, prev.summary.removed - 1) : prev.summary.removed,
                replies: deletedRow.isReply ? Math.max(0, prev.summary.replies - 1) : prev.summary.replies,
              },
            }
          : prev,
      );
      setPermanentDeleteTarget(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not permanently delete comment.');
    } finally {
      setDeleteSubmitting(false);
    }
  }

  const tiles = useMemo(
    () =>
      summary
        ? [
            { label: 'Comments', value: numberFormat.format(summary.total) },
            { label: 'Visible', value: numberFormat.format(summary.visible) },
            { label: 'Removed', value: numberFormat.format(summary.removed) },
            { label: 'Replies', value: numberFormat.format(summary.replies) },
            { label: 'Likes given', value: numberFormat.format(summary.likes) },
          ]
        : [],
    [summary],
  );

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Comments</h1>
          <p className="mt-1 text-sm text-muted">
            Every comment and reply across the platform.
          </p>
        </div>
        <Link
          href="/admin/audience"
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium hover:border-brand/50"
        >
          Audience
        </Link>
      </div>

      <section className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <StatTile key={tile.label} label={tile.label} value={tile.value} />
        ))}
      </section>

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
          placeholder="Search text, author or story"
          aria-label="Search comments"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-brand sm:max-w-sm"
        />
      </section>

      <section className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1">
          {ACCOUNTS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setAccount(option.id);
                setPage(1);
                setLoading(true);
              }}
              aria-pressed={account === option.id}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                account === option.id
                  ? 'bg-brand text-brand-contrast'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <select
          value={newsLocation}
          aria-label="Filter by news location"
          onChange={(event) => {
            setNewsLocation(event.target.value);
            setPage(1);
            setLoading(true);
          }}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-brand"
        >
          <option value="">All news locations</option>
          {newsLocations.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} ({numberFormat.format(option.count)})
            </option>
          ))}
        </select>
      </section>

      {/* Dedicated Commenter Location Filter (Country 1st -> State 2nd) */}
      <section className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted">
            <span>📍 Commenter Location:</span>
          </span>

          {/* 1. Country */}
          <div className="flex items-center gap-2">
            <label htmlFor="comments-country-select" className="text-xs font-medium text-foreground">
              1. Country:
            </label>
            <select
              id="comments-country-select"
              value={country}
              aria-label="Filter by commenter country (1st)"
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
            <label htmlFor="comments-state-select" className="text-xs font-medium text-foreground">
              2. State:
            </label>
            <select
              id="comments-state-select"
              value={state}
              aria-label="Filter by commenter state (2nd)"
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
              <label htmlFor="comments-city-select" className="text-xs font-medium text-muted">
                City:
              </label>
              <select
                id="comments-city-select"
                value={city}
                aria-label="Filter by author city"
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
        <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      <section className="mt-4 overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
        {!country || !state ? (
          <div className="px-4 py-16 text-center">
            <div className="mx-auto flex max-w-sm flex-col items-center justify-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-xl text-brand">
                📍
              </div>
              <h3 className="mt-3 text-base font-semibold text-foreground">
                {!country ? 'Step 1: Select Country' : 'Step 2: Select State'}
              </h3>
              <p className="mt-1 text-xs text-muted">
                {!country
                  ? 'Please choose a country from the filter above to begin browsing comments.'
                  : `Selected country: ${country}. Now select a state to display comments.`}
              </p>
            </div>
          </div>
        ) : (
          <>
            {loading && rows.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-muted">Loading comments…</p>
            )}
            {!loading && rows.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-muted">
                No comments match that view.
              </p>
            )}

            <div className="divide-y divide-border">
              {rows.map((row) => (
                <article key={row.id} className="px-4 py-4">
                  <div className="flex items-start gap-3">
                    <Avatar src={row.author.avatarSrc} name={row.author.name} />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <Link
                          href={`/admin/audience/${row.authorId}`}
                          className="font-medium hover:text-brand hover:underline"
                        >
                          {row.author.name}
                        </Link>
                        {row.isReply && (
                          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                            reply
                          </span>
                        )}
                        {row.deleted && (
                          <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                            removed
                          </span>
                        )}
                        {row.authorStatus === 'SUSPENDED' && (
                          <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                            suspended account
                          </span>
                        )}
                        {(row.authorCity || row.authorState || row.authorCountry) && (
                          <span className="text-xs text-muted">
                            {[row.authorCity, row.authorState, row.authorCountry]
                              .filter(Boolean)
                              .join(', ')}
                          </span>
                        )}
                        <span className="text-xs text-muted tabular-nums">
                          {formatWhen(row.createdAt)}
                        </span>
                      </div>

                      <p className="mt-0.5 text-xs text-muted">
                        on{' '}
                        <span className="font-medium text-foreground">
                          {row.articleTitle ?? `article ${row.articleId}`}
                        </span>
                        {row.articleLocation && <span> · {row.articleLocation}</span>}
                      </p>

                      {row.parent && (
                        <p className="mt-2 border-l-2 border-border pl-3 text-xs text-muted italic">
                          replying to {row.parent.author.name}:{' '}
                          {row.parent.body ? `“${row.parent.body.slice(0, 90)}”` : '(removed)'}
                        </p>
                      )}

                      <p
                        className={`mt-2 text-sm break-words ${
                          row.deleted ? 'text-muted line-through' : ''
                        }`}
                      >
                        {row.body}
                      </p>

                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted tabular-nums">
                        <span>{row.likeCount} likes</span>
                        <span>{row.replyCount} replies</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={busyId === row.id || deleteSubmitting}
                        onClick={() => moderate(row)}
                        title={row.deleted ? 'Restore comment to thread' : 'Withdraw comment text'}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 whitespace-nowrap ${
                          row.deleted
                            ? 'border-success/40 text-success hover:bg-success/10'
                            : 'border-muted/40 text-muted hover:border-foreground hover:text-foreground'
                        }`}
                      >
                        {busyId === row.id ? '…' : row.deleted ? 'Restore' : 'Soft Remove'}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === row.id || deleteSubmitting}
                        onClick={() => setPermanentDeleteTarget(row)}
                        title="Permanently remove from database"
                        className="rounded-lg border border-danger/40 bg-danger/5 px-2.5 py-1 text-xs font-medium text-danger transition hover:bg-danger hover:text-white disabled:opacity-50 whitespace-nowrap"
                      >
                        🗑 Delete Permanent
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
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
                    : `Show ${numberFormat.format(Math.min(pageSize, remaining))} more`}
                </button>
              ) : (
                rows.length > 0 && <span className="text-muted">That is everyone.</span>
              )}
              <span className="text-muted">
                Showing {numberFormat.format(rows.length)} of {numberFormat.format(data.total)} comments in{' '}
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

      {/* Permanent Delete Confirmation Modal */}
      {permanentDeleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="relative w-full max-w-md rounded-2xl border border-danger/30 bg-surface p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-danger">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-danger/10 text-base">
                ⚠️
              </span>
              <h2 className="text-lg font-bold">Delete Comment Permanently?</h2>
            </div>

            <p className="mt-3 text-sm text-foreground">
              Are you sure you want to permanently delete this comment by{' '}
              <strong className="text-brand">{permanentDeleteTarget.author.name}</strong>?
            </p>

            <div className="mt-3 rounded-lg border border-border bg-background p-3 text-xs text-muted">
              <p className="line-clamp-3 italic">
                “{permanentDeleteTarget.body || '(no text)'}”
              </p>
              <div className="mt-2 text-[11px] text-muted/70">
                Story: {permanentDeleteTarget.articleTitle || `ID: ${permanentDeleteTarget.articleId}`}
              </div>
            </div>

            <p className="mt-3 text-xs text-danger/90">
              <strong>Warning:</strong> This will completely remove the comment record and all its likes from the database. This action cannot be undone.
            </p>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPermanentDeleteTarget(null)}
                disabled={deleteSubmitting}
                className="rounded-lg border border-border bg-background px-3.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteSubmitting}
                onClick={handlePermanentDelete}
                className="rounded-lg border border-danger bg-danger px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-danger/90 disabled:opacity-50"
              >
                {deleteSubmitting ? 'Deleting…' : 'Yes, Delete Permanent'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
