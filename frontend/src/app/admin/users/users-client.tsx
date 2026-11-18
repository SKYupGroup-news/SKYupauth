'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

export interface UserRow {
  id: string;
  email: string | null;
  displayName: string | null;
  phone: string | null;
  role: 'ADMIN' | 'EDITOR' | 'READER';
  status: 'ACTIVE' | 'SUSPENDED';
  country: string | null;
  state?: string | null;
  city: string | null;
  officeLocation?: string | null;
  avatarSrc: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  hasPassword: boolean;
  authSource: string;
  isPaid: boolean;
  planKey: string | null;
  activeSessions: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserSummary {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  verifiedUsers: number;
  paidUsers: number;
}

export function UsersClient({ currentAdminId }: { currentAdminId: string }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [summary, setSummary] = useState<UserSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters — user must filter by Country (1st) and State (2nd) before data appears
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [verifiedFilter, setVerifiedFilter] = useState<string>('all');
  const [countryFilter, setCountryFilter] = useState<string>('');
  const [stateFilter, setStateFilter] = useState<string>('');
  const [countries, setCountries] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [countryStateMap, setCountryStateMap] = useState<Record<string, string[]>>({});
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Create Customer Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newCountry, setNewCountry] = useState('');
  const [newState, setNewState] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newOfficeLocation, setNewOfficeLocation] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newStatus, setNewStatus] = useState<'ACTIVE' | 'SUSPENDED'>('ACTIVE');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Delete User Confirmation
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  // Action status tracker
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  // Available states cascading from selected country
  const availableStates = useMemo(() => {
    if (!countryFilter) return [];
    if (countryStateMap[countryFilter] && countryStateMap[countryFilter].length > 0) {
      return countryStateMap[countryFilter];
    }
    return states;
  }, [countryFilter, countryStateMap, states]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 280);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch Users & Filter Metadata
  async function loadUsers(initialFetch = false) {
    // If not both country & state are selected, we do not fetch user rows (only initial metadata on mount)
    if (!initialFetch && (!countryFilter || !stateFilter)) {
      setUsers([]);
      setTotalCount(0);
      setTotalPages(1);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '25',
      });
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (verifiedFilter !== 'all') params.set('verified', verifiedFilter);
      if (countryFilter) params.set('country', countryFilter);
      if (stateFilter) params.set('state', stateFilter);

      const res = await fetch(`/api/admin/users?${params.toString()}`);
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to load audience profiles.');
      }

      setSummary(payload.summary || null);
      if (payload.countries) setCountries(payload.countries);
      if (payload.states) setStates(payload.states);
      if (payload.countryStateMap) setCountryStateMap(payload.countryStateMap);

      if (countryFilter && stateFilter) {
        setUsers(payload.users || []);
        setTotalPages(payload.pagination?.totalPages || 1);
        setTotalCount(payload.pagination?.total || 0);
      } else {
        setUsers([]);
        setTotalCount(0);
        setTotalPages(1);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error loading audience profiles');
    } finally {
      setLoading(false);
    }
  }

  // Load available country/state lists and metrics on mount
  useEffect(() => {
    loadUsers(true);
  }, []);

  // Re-fetch users only when BOTH country and state filters are selected
  useEffect(() => {
    if (countryFilter && stateFilter) {
      loadUsers(false);
    } else {
      setUsers([]);
      setTotalCount(0);
      setTotalPages(1);
    }
  }, [debouncedSearch, statusFilter, verifiedFilter, countryFilter, stateFilter, page]);

  // Toggle Status (ACTIVE <-> SUSPENDED)
  async function handleToggleStatus(user: UserRow) {
    const targetStatus = user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    setBusyUserId(user.id);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, status: targetStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Failed to update status');

      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, status: targetStatus } : u))
      );
      if (summary) {
        setSummary({
          ...summary,
          activeUsers: targetStatus === 'ACTIVE' ? summary.activeUsers + 1 : summary.activeUsers - 1,
          suspendedUsers: targetStatus === 'SUSPENDED' ? summary.suspendedUsers + 1 : summary.suspendedUsers - 1,
        });
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error updating status');
    } finally {
      setBusyUserId(null);
    }
  }

  // Handle Create User
  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setCreateSubmitting(true);
    setCreateError(null);

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newEmail,
          displayName: newName,
          phone: newPhone || null,
          country: newCountry || null,
          state: newState || null,
          city: newCity || null,
          officeLocation: newOfficeLocation || null,
          status: newStatus,
          password: newPassword,
        }),
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to create audience profile.');
      }

      setShowCreateModal(false);
      setNewEmail('');
      setNewName('');
      setNewPhone('');
      setNewCountry('');
      setNewState('');
      setNewCity('');
      setNewOfficeLocation('');
      setNewPassword('');
      await loadUsers();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Error creating audience profile');
    } finally {
      setCreateSubmitting(false);
    }
  }

  // Handle Delete User
  async function handleDeleteUser() {
    if (!deleteTarget) return;
    setDeleteSubmitting(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Failed to delete profile');

      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setDeleteTarget(null);
      if (summary) {
        setSummary({
          ...summary,
          totalUsers: summary.totalUsers - 1,
          activeUsers: deleteTarget.status === 'ACTIVE' ? summary.activeUsers - 1 : summary.activeUsers,
        });
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error deleting profile');
    } finally {
      setDeleteSubmitting(false);
    }
  }

  // Helper for Initials
  function getInitials(u: UserRow) {
    const raw = u.displayName || u.email || u.phone || 'C';
    const clean = raw.replace(/[^a-zA-Z0-9]/g, ' ').trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return raw.slice(0, 2).toUpperCase();
  }

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
      {/* Top Header & Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-xs font-bold text-brand-contrast">
              AP
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-brand">
              SkyUp News Audience
            </span>
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
              Customer Profiles
            </span>
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">
            Audience Customer Profiles
          </h1>
          <p className="mt-1 text-sm text-muted">
            Manage registered audience customer profiles, verification status, and credentials for the news project.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setShowCreateModal(true);
              setCreateError(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand bg-brand px-3.5 py-2 text-sm font-semibold text-brand-contrast shadow-sm transition hover:bg-brand-strong"
          >
            <span aria-hidden="true" className="text-base font-bold">+</span>
            Add Customer Profile
          </button>

          <Link
            href="/admin/audience"
            className="rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium text-muted transition hover:border-brand/50 hover:text-foreground"
          >
            Subscribers
          </Link>

          <Link
            href="/admin/employees"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium text-muted transition hover:border-brand/50 hover:text-foreground"
          >
            <span>👔</span> Employees
          </Link>

          <Link
            href="/admin/integration"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium text-muted transition hover:border-brand/50 hover:text-foreground"
          >
            <span>🔌</span> API Integration
          </Link>

          <Link
            href="/account"
            className="rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium text-muted transition hover:border-brand/50 hover:text-foreground"
          >
            My Account
          </Link>
        </div>
      </div>

      {/* KPI Stats Row — Focused on Audience Metrics */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Total Audience Profiles</span>
          <p className="mt-2 text-2xl font-bold text-foreground">
            {summary ? summary.totalUsers : '—'}
          </p>
          <span className="mt-1 block text-xs text-muted">Registered news readers</span>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Active Customers</span>
          <p className="mt-2 text-2xl font-bold text-success">
            {summary ? summary.activeUsers : '—'}
          </p>
          <span className="mt-1 block text-xs text-muted">Eligible to read & sign in</span>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Verified Profiles</span>
          <p className="mt-2 text-2xl font-bold text-brand">
            {summary ? summary.verifiedUsers : '—'}
          </p>
          <span className="mt-1 block text-xs text-muted">Confirmed email accounts</span>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Paid Subscribers</span>
          <p className="mt-2 text-2xl font-bold text-[#b5801a]">
            {summary ? summary.paidUsers : '—'}
          </p>
          <span className="mt-1 block text-xs text-muted">Active news subscription</span>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Suspended Profiles</span>
          <p className="mt-2 text-2xl font-bold text-danger">
            {summary ? summary.suspendedUsers : '—'}
          </p>
          <span className="mt-1 block text-xs text-muted">Blocked from accessing</span>
        </div>
      </section>

      {/* Search & Filter Toolbar */}
      <div className="mt-6 space-y-3 rounded-xl border border-border bg-surface/50 p-3.5 shadow-sm">
        {/* Top Row: Search & Status / Verification / Counter / Refresh */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-1 flex-wrap items-center gap-3 min-w-[280px]">
            {/* Search Input */}
            <div className="relative w-full sm:w-72">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted">
                🔍
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email, phone..."
                className="w-full rounded-lg border border-border bg-background py-1.5 pl-9 pr-8 text-xs placeholder:text-muted focus:border-brand focus:outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-xs text-muted hover:text-foreground"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-1.5">
              <label htmlFor="status-select" className="text-xs font-medium text-muted">Status:</label>
              <select
                id="status-select"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground focus:border-brand focus:outline-none"
              >
                <option value="ALL">All Status</option>
                <option value="ACTIVE">Active Only</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
            </div>

            {/* Verification Filter */}
            <div className="flex items-center gap-1.5">
              <label htmlFor="verify-select" className="text-xs font-medium text-muted">Verification:</label>
              <select
                id="verify-select"
                value={verifiedFilter}
                onChange={(e) => {
                  setVerifiedFilter(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground focus:border-brand focus:outline-none"
              >
                <option value="all">All Profiles</option>
                <option value="verified">Verified Only</option>
                <option value="unverified">Unverified Only</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <span className="text-xs text-muted">
              {countryFilter && stateFilter ? (
                <>
                  Showing <strong className="text-foreground">{users.length}</strong> of {totalCount} profiles in{' '}
                  <strong className="text-brand">{stateFilter}, {countryFilter}</strong>
                </>
              ) : (
                <span className="italic text-muted/80">Select Country & State to view records</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => loadUsers(true)}
              disabled={loading}
              title="Refresh table"
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-muted transition hover:border-brand/50 hover:text-foreground disabled:opacity-50"
            >
              {loading ? 'Refreshing…' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {/* Bottom Row: Dedicated Location Filter (Country 1st -> State 2nd) */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted">
              <span>📍 Location Filter:</span>
            </span>

            {/* 1. Country */}
            <div className="flex items-center gap-2">
              <label htmlFor="country-select" className="text-xs font-medium text-foreground">
                1. Country:
              </label>
              <select
                id="country-select"
                value={countryFilter}
                onChange={(e) => {
                  setCountryFilter(e.target.value);
                  setStateFilter('');
                  setPage(1);
                }}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm focus:border-brand focus:outline-none"
              >
                <option value="">— Select Country (1st) —</option>
                {countries.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* 2. State */}
            <div className="flex items-center gap-2">
              <label htmlFor="state-select" className="text-xs font-medium text-foreground">
                2. State:
              </label>
              <select
                id="state-select"
                value={stateFilter}
                disabled={!countryFilter}
                onChange={(e) => {
                  setStateFilter(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm focus:border-brand focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">
                  {!countryFilter ? 'Select Country First' : '— Select State (2nd) —'}
                </option>
                {availableStates.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* Clear Location Button */}
            {(countryFilter || stateFilter) && (
              <button
                type="button"
                onClick={() => {
                  setCountryFilter('');
                  setStateFilter('');
                  setPage(1);
                }}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-danger hover:text-danger hover:bg-danger/5 shadow-sm"
              >
                <span>✕</span>
                <span className="font-semibold">Clear Location</span>
              </button>
            )}
          </div>

          {countryFilter && stateFilter && (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
              <span>Territory:</span>
              <span>{stateFilter}, {countryFilter}</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Audience Profiles Table */}
      <section className="mt-4 overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface/80 text-xs font-semibold uppercase tracking-wider text-muted">
                <th className="px-4 py-3.5">Customer Profile</th>
                <th className="px-4 py-3.5">Contact & Location</th>
                <th className="px-4 py-3.5">Account Status</th>
                <th className="px-4 py-3.5">Verification</th>
                <th className="px-4 py-3.5">Sign-in Method</th>
                <th className="px-4 py-3.5">Registered Date</th>
                <th className="px-4 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {!countryFilter ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-2xl text-brand shadow-sm">
                      🌍
                    </div>
                    <p className="mt-3 text-base font-semibold text-foreground">Select a Country to View Audience Data</p>
                    <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                      Please select a Country from the filter above (Step 1), then select a State (Step 2) to display audience users according to your location filter.
                    </p>
                  </td>
                </tr>
              ) : !stateFilter ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-2xl text-brand shadow-sm">
                      📍
                    </div>
                    <p className="mt-3 text-base font-semibold text-foreground">
                      Country selected: <span className="text-brand">{countryFilter}</span>
                    </p>
                    <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                      Now select a State in {countryFilter} from the filter above (Step 2) to display the customer profiles for that territory.
                    </p>
                  </td>
                </tr>
              ) : loading && users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted">
                    <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                    <p className="mt-2 text-sm">Loading audience profiles in {stateFilter}, {countryFilter}…</p>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted">
                    <p className="text-base font-medium text-foreground">No audience customer profiles found in {stateFilter}, {countryFilter}.</p>
                    <p className="mt-1 text-sm text-muted">Try selecting a different state or resetting search keywords.</p>
                    <button
                      type="button"
                      onClick={() => {
                        setSearch('');
                        setStatusFilter('ALL');
                        setVerifiedFilter('all');
                      }}
                      className="mt-4 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:border-brand"
                    >
                      Reset Keyword Filters
                    </button>
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isSelf = u.id === currentAdminId;
                  const isBusy = busyUserId === u.id;

                  return (
                    <tr
                      key={u.id}
                      className={`transition-colors hover:bg-background/40 ${
                        u.status === 'SUSPENDED' ? 'opacity-75 bg-danger/5' : ''
                      }`}
                    >
                      {/* Customer Profile Column */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 font-bold text-brand ring-1 ring-border">
                            {u.avatarSrc ? (
                              <img
                                src={u.avatarSrc}
                                alt={u.displayName || u.email || 'Avatar'}
                                className="h-full w-full rounded-full object-cover"
                              />
                            ) : (
                              getInitials(u)
                            )}
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface ${
                                u.status === 'ACTIVE' ? 'bg-success' : 'bg-danger'
                              }`}
                              title={u.status}
                            />
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-semibold text-foreground">
                                {u.displayName || 'Unnamed Reader'}
                              </span>
                              {u.isPaid && (
                                <span className="rounded bg-[#b5801a]/15 px-1.5 py-0.2 text-[10px] font-bold text-[#b5801a] uppercase">
                                  Paid
                                </span>
                              )}
                              {isSelf && (
                                <span className="rounded bg-brand/15 px-1.5 py-0.2 text-[10px] font-bold text-brand uppercase">
                                  Current User
                                </span>
                              )}
                            </div>
                            <span className="block truncate text-xs text-muted">
                              {u.email || 'No Email'}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Contact & Location Column */}
                      <td className="px-4 py-3">
                        <div className="text-xs">
                          <span className="block font-medium text-foreground">
                            {u.phone || '—'}
                          </span>
                          {u.officeLocation && (
                            <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand">
                              🏢 {u.officeLocation}
                            </span>
                          )}
                          {(u.city || u.state || u.country) ? (
                            <span className="block text-muted">
                              {[u.city, u.state, u.country].filter(Boolean).join(', ')}
                            </span>
                          ) : (
                            !u.officeLocation && <span className="block text-muted/60">—</span>
                          )}
                        </div>
                      </td>

                      {/* Status Column */}
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          disabled={isBusy || isSelf}
                          onClick={() => handleToggleStatus(u)}
                          title={isSelf ? 'Cannot suspend current account' : 'Click to toggle status'}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition ${
                            u.status === 'ACTIVE'
                              ? 'bg-success/15 text-success hover:bg-success/25'
                              : 'bg-danger/15 text-danger hover:bg-danger/25'
                          } disabled:cursor-not-allowed`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              u.status === 'ACTIVE' ? 'bg-success' : 'bg-danger'
                            }`}
                          />
                          {u.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                        </button>
                      </td>

                      {/* Verification Column */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1 text-xs">
                          {u.emailVerified ? (
                            <span className="inline-flex items-center gap-1 text-success">
                              <span>✓</span> Email verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-muted">
                              <span>•</span> Unverified email
                            </span>
                          )}
                          {u.phone && (
                            <span className="text-[11px] text-muted">
                              {u.phoneVerified ? '✓ Phone verified' : '• Phone unverified'}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Sign-in Method Column */}
                      <td className="px-4 py-3">
                        <span className="inline-block rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">
                          {u.authSource}
                        </span>
                      </td>

                      {/* Created Date Column */}
                      <td className="px-4 py-3 text-xs text-muted">
                        {new Date(u.createdAt).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>

                      {/* Actions Column */}
                      <td className="px-4 py-3 text-right">
                        {!isSelf ? (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(u)}
                            title="Delete customer profile"
                            className="rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-danger transition hover:border-danger hover:bg-danger/10"
                          >
                            Delete
                          </button>
                        ) : (
                          <span className="text-xs text-muted/60">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border border-border bg-background px-3 py-1 font-medium text-foreground transition hover:border-brand disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded border border-border bg-background px-3 py-1 font-medium text-foreground transition hover:border-brand disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ========================================================================= */}
      {/* MODAL 1: Create New Customer Profile Modal                                 */}
      {/* ========================================================================= */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-foreground">Add New Customer Profile</h2>
                <p className="mt-1 text-xs text-muted">
                  Create a new registered reader profile for the audience news project.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg p-1 text-muted hover:bg-background hover:text-foreground"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
                  Full Name <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. John Reader"
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
                  Email Address <span className="text-danger">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="reader@example.com"
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
                    Phone (Optional)
                  </label>
                  <input
                    type="tel"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="+919876543210"
                    className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
                    Country (Optional)
                  </label>
                  <input
                    type="text"
                    value={newCountry}
                    onChange={(e) => setNewCountry(e.target.value)}
                    placeholder="e.g. India, USA"
                    className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
                    State / Province (Optional)
                  </label>
                  <input
                    type="text"
                    value={newState}
                    onChange={(e) => setNewState(e.target.value)}
                    placeholder="e.g. Maharashtra, California"
                    className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
                    City (Optional)
                  </label>
                  <input
                    type="text"
                    value={newCity}
                    onChange={(e) => setNewCity(e.target.value)}
                    placeholder="e.g. Mumbai, New York"
                    className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
                  Allotted Office Location
                </label>
                <input
                  type="text"
                  value={newOfficeLocation}
                  onChange={(e) => setNewOfficeLocation(e.target.value)}
                  placeholder="e.g. Delhi Bureau, Noida HQ, Mumbai Branch"
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
                    Account Status
                  </label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as 'ACTIVE' | 'SUSPENDED')}
                    className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground focus:border-brand focus:outline-none"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="SUSPENDED">SUSPENDED</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
                    Initial Password
                  </label>
                  <input
                    type="text"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus:border-brand focus:outline-none"
                  />
                </div>
              </div>

              {createError && (
                <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
                  {createError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-surface"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createSubmitting}
                  className="inline-flex items-center gap-2 rounded-lg border border-brand bg-brand px-4 py-2 text-sm font-semibold text-brand-contrast transition hover:bg-brand-strong disabled:opacity-50"
                >
                  {createSubmitting ? 'Creating…' : 'Create Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: Delete Confirmation Modal                                        */}
      {/* ========================================================================= */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="relative w-full max-w-sm rounded-2xl border border-danger/30 bg-surface p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-danger">Delete Customer Profile?</h2>
            <p className="mt-2 text-sm text-foreground">
              Are you sure you want to permanently delete customer profile{' '}
              <strong className="text-foreground">{deleteTarget.displayName || deleteTarget.email}</strong>?
            </p>
            <p className="mt-1 text-xs text-muted">
              This action cannot be undone. All active sessions and preferences for this reader profile will be removed.
            </p>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-border bg-background px-3.5 py-1.5 text-sm font-medium text-foreground hover:bg-surface"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteSubmitting}
                onClick={handleDeleteUser}
                className="rounded-lg border border-danger bg-danger px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-danger/90 disabled:opacity-50"
              >
                {deleteSubmitting ? 'Deleting…' : 'Yes, Delete Profile'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
