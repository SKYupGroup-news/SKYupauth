'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Connector {
  id: string;
  name: string;
  url: string;
  port: number;
  type: string;
  status: string;
  latency?: number | null;
  checking?: boolean;
}

export function IntegrationClient({ userEmail }: { userEmail: string | null }) {
  const [connectors, setConnectors] = useState<Connector[]>([
    {
      id: 'news_feed_service',
      name: 'SkyUp News (Audience Platform)',
      url: 'https://skyupnews.com',
      port: 443,
      type: 'LIVE_NEWS_PLATFORM',
      status: 'CHECKING',
    },
    {
      id: 'reporter_backend',
      name: 'Media House (Editorial Gateway)',
      url: 'https://mediahouse.skyupnews.com/',
      port: 443,
      type: 'EDITORIAL_GATEWAY',
      status: 'CHECKING',
    },
    {
      id: 'feed_analyst',
      name: 'News Analyst Engine',
      url: 'https://newsanalyst.skyupnews.com/login',
      port: 443,
      type: 'ANALYTICS_SERVICE',
      status: 'CHECKING',
    },
    {
      id: 'auth_backend',
      name: 'SkyUp Auth Identity Service',
      url: 'https://auth.skyupnews.com/api/health',
      port: 443,
      type: 'CORE_IDENTITY_EMS',
      status: 'CHECKING',
    },
  ]);

  // EMS Synchronization form state
  const [emsApiUrl, setEmsApiUrl] = useState('https://auth.skyupnews.com/api/integration');
  const [emsApiKey, setEmsApiKey] = useState('');
  const [emsRole, setEmsRole] = useState<'READER' | 'EDITOR' | 'ADMIN'>('READER');
  const [emsDepartment, setEmsDepartment] = useState('');
  const [emsSyncing, setEmsSyncing] = useState(false);
  const [emsResult, setEmsResult] = useState<{
    ok: boolean;
    message: string;
    createdCount?: number;
    updatedCount?: number;
    fetchedCount?: number;
  } | null>(null);

  // Endpoint Probe Tester state
  const [testUrl, setTestUrl] = useState('https://skyupnews.com');
  const [testMethod, setTestMethod] = useState<'GET' | 'POST' | 'HEAD'>('GET');
  const [testAuthHeader, setTestAuthHeader] = useState('');
  const [testTesting, setTestTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    status: number;
    statusText: string;
    latencyMs: number;
  } | null>(null);

  // Key reveal state
  const [keyRevealed, setKeyRevealed] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const secretIngestKey = 'skyup_ingest_sec_7a9f4c2e1b80';

  useEffect(() => {
    // Probe all connectors initially
    connectors.forEach((c) => pingConnector(c.id, c.url));
  }, []);

  async function pingConnector(id: string, url: string) {
    setConnectors((prev) =>
      prev.map((c) => (c.id === id ? { ...c, checking: true } : c))
    );

    try {
      const res = await fetch('/api/admin/integration/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, method: 'GET' }),
      });
      const data = await res.json();
      setConnectors((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                checking: false,
                status: data.ok || (data.status >= 200 && data.status < 400) ? 'ONLINE' : 'OFFLINE',
                latency: data.latencyMs,
              }
            : c
        )
      );
    } catch {
      setConnectors((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, checking: false, status: 'OFFLINE', latency: null } : c
        )
      );
    }
  }

  async function handleEmsSync(e: React.FormEvent) {
    e.preventDefault();
    setEmsSyncing(true);
    setEmsResult(null);

    try {
      const res = await fetch('/api/admin/integration/ems/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiUrl: emsApiUrl,
          apiKey: emsApiKey,
          defaultRole: emsRole,
          departmentFilter: emsDepartment,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? 'Integration sync failed');
      }

      setEmsResult({
        ok: true,
        message: data.message || 'Users synchronized successfully',
        createdCount: data.createdCount,
        updatedCount: data.updatedCount,
        fetchedCount: data.fetchedCount,
      });
    } catch (err: any) {
      setEmsResult({
        ok: false,
        message: err.message || 'Error executing API integration sync',
      });
    } finally {
      setEmsSyncing(false);
    }
  }

  async function handleTestProbe(e: React.FormEvent) {
    e.preventDefault();
    setTestTesting(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/admin/integration/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: testUrl,
          method: testMethod,
          authHeader: testAuthHeader || undefined,
        }),
      });

      const data = await res.json();
      setTestResult({
        ok: data.ok,
        status: data.status,
        statusText: data.statusText,
        latencyMs: data.latencyMs,
      });
    } catch (err: any) {
      setTestResult({
        ok: false,
        status: 0,
        statusText: err.message || 'Probe error',
        latencyMs: 0,
      });
    } finally {
      setTestTesting(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      {/* Top Header & Navigation */}
      <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              🔌 API Integration Hub
            </h1>
            <span className="rounded-full bg-brand/15 px-2.5 py-0.5 text-xs font-semibold text-brand">
              Admin Authorized: {userEmail}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            Configure upstream microservice connectors, EMS roster synchronizations, and live endpoint diagnostics.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/users"
            className="rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium text-muted transition hover:border-brand/50 hover:text-foreground"
          >
            Audience Profiles
          </Link>
          <Link
            href="/admin/audience"
            className="rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium text-muted transition hover:border-brand/50 hover:text-foreground"
          >
            Subscribers
          </Link>
          <Link
            href="/admin/comments"
            className="rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium text-muted transition hover:border-brand/50 hover:text-foreground"
          >
            Comments
          </Link>
          <Link
            href="/account"
            className="rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium text-muted transition hover:border-brand/50 hover:text-foreground"
          >
            My Account
          </Link>
        </div>
      </div>

      {/* Microservice Connectors Status Grid */}
      <section className="mt-8">
        <h2 className="text-base font-semibold text-foreground">Connected Microservices & Connectors</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {connectors.map((c) => (
            <div
              key={c.id}
              className="flex flex-col justify-between rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)] transition hover:border-brand/40"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="rounded-md bg-background px-2 py-0.5 font-mono text-[11px] font-medium text-muted">
                    Port :{c.port}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      c.status === 'ONLINE'
                        ? 'bg-success/15 text-success'
                        : c.status === 'CHECKING'
                        ? 'bg-muted/15 text-muted animate-pulse'
                        : 'bg-danger/15 text-danger'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        c.status === 'ONLINE'
                          ? 'bg-success'
                          : c.status === 'CHECKING'
                          ? 'bg-muted'
                          : 'bg-danger'
                      }`}
                    />
                    {c.status}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-foreground">{c.name}</h3>
                <p className="mt-1 truncate font-mono text-xs text-muted" title={c.url}>
                  {c.url}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-xs">
                <span className="text-muted">
                  {c.latency !== undefined && c.latency !== null ? `${c.latency} ms` : '—'}
                </span>
                <div className="flex items-center gap-1.5">
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded border border-border bg-background px-2 py-1 font-medium text-foreground transition hover:border-brand"
                  >
                    Open ↗
                  </a>
                  <button
                    type="button"
                    onClick={() => pingConnector(c.id, c.url)}
                    disabled={c.checking}
                    className="rounded border border-border bg-background px-2 py-1 font-medium text-foreground transition hover:border-brand disabled:opacity-50"
                  >
                    {c.checking ? 'Testing…' : 'Ping'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Dual Column: EMS Integration Sync & Ingest Bearer Key */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* EMS Sync Engine */}
        <div className="rounded-xl border border-border bg-surface p-6 shadow-[var(--shadow-card)] lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">EMS Roster & External Employee Sync</h2>
              <p className="mt-1 text-xs text-muted">
                Synchronize organization staff and reporter accounts directly into SkyUp Auth.
              </p>
            </div>
            <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
              REST Sync Connector
            </span>
          </div>

          <form onSubmit={handleEmsSync} className="mt-6 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-foreground">EMS API Base URL</label>
                <input
                  type="text"
                  required
                  value={emsApiUrl}
                  onChange={(e) => setEmsApiUrl(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono text-foreground outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                  placeholder="https://auth.skyupnews.com/api/integration"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground">Authorization Bearer API Key</label>
                <input
                  type="password"
                  value={emsApiKey}
                  onChange={(e) => setEmsApiKey(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono text-foreground outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                  placeholder="Optional or Bearer Token"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-foreground">Department Filter</label>
                <input
                  type="text"
                  value={emsDepartment}
                  onChange={(e) => setEmsDepartment(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                  placeholder="e.g. Editorial, Bureau, Delhi (Optional)"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground">Default Assigned Role</label>
                <select
                  value={emsRole}
                  onChange={(e) => setEmsRole(e.target.value as any)}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                >
                  <option value="READER">READER (Customer Profile)</option>
                  <option value="EDITOR">EDITOR (Staff Reporter)</option>
                  <option value="ADMIN">ADMIN (System Administrator)</option>
                </select>
              </div>
            </div>

            {emsResult && (
              <div
                className={`rounded-lg border p-4 text-sm ${
                  emsResult.ok
                    ? 'border-success/30 bg-success/10 text-success'
                    : 'border-danger/30 bg-danger/10 text-danger'
                }`}
              >
                <p className="font-semibold">{emsResult.message}</p>
                {emsResult.ok && emsResult.createdCount !== undefined && (
                  <p className="mt-1 text-xs opacity-90">
                    Created: <strong>{emsResult.createdCount}</strong> new profiles | Updated: <strong>{emsResult.updatedCount}</strong> | Total records processed: <strong>{emsResult.fetchedCount}</strong>
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={emsSyncing}
                className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-brand-contrast transition hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60 shadow-sm"
              >
                {emsSyncing ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-contrast border-t-transparent" />
                    Connecting & Synchronizing…
                  </>
                ) : (
                  <>
                    <span>🔄</span> Synchronize External API
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Ingest Key Manager */}
        <div className="rounded-xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
          <h2 className="text-base font-semibold text-foreground">System Secret Ingest Key</h2>
          <p className="mt-1 text-xs text-muted">
            Secret header key for high-volume upstream collector daemons.
          </p>

          <div className="mt-5 rounded-lg border border-border bg-background p-3.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted">Ingest Header</span>
            <div className="mt-1 font-mono text-xs text-foreground">
              {keyRevealed ? secretIngestKey : 'skyup_ingest_sec••••••••••••'}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setKeyRevealed(!keyRevealed)}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition hover:border-brand"
            >
              {keyRevealed ? 'Hide Secret' : 'Reveal Secret'}
            </button>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(secretIngestKey);
                setCopiedKey(true);
                setTimeout(() => setCopiedKey(false), 2000);
              }}
              className="flex-1 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-brand-contrast transition hover:bg-brand-strong"
            >
              {copiedKey ? '✓ Copied' : 'Copy Key'}
            </button>
          </div>

          <div className="mt-6 border-t border-border/70 pt-4">
            <h3 className="text-xs font-semibold text-foreground">Header Compatibility</h3>
            <div className="mt-2 space-y-1.5 font-mono text-[11px] text-muted">
              <div>• X-Ingest-Key: {keyRevealed ? secretIngestKey : '••••••'}</div>
              <div>• Authorization: Bearer {keyRevealed ? secretIngestKey : '••••••'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Live Endpoint Diagnostic Probe Tester */}
      <section className="mt-8 rounded-xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
        <h2 className="text-base font-semibold text-foreground">Live Endpoint Diagnostic Probe</h2>
        <p className="mt-1 text-xs text-muted">
          Send a lightweight ping to any microservice endpoint to measure latency and verify network status.
        </p>

        <form onSubmit={handleTestProbe} className="mt-5 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <select
              value={testMethod}
              onChange={(e) => setTestMethod(e.target.value as any)}
              className="w-full sm:w-28 rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground outline-none focus:border-brand"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="HEAD">HEAD</option>
            </select>

            <input
              type="url"
              required
              value={testUrl}
              onChange={(e) => setTestUrl(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono text-foreground outline-none focus:border-brand"
              placeholder="https://skyupnews.com"
            />

            <button
              type="submit"
              disabled={testTesting}
              className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-brand-contrast transition hover:bg-brand-strong disabled:opacity-50"
            >
              {testTesting ? 'Sending…' : 'Send Probe'}
            </button>
          </div>

          <div>
            <input
              type="text"
              value={testAuthHeader}
              onChange={(e) => setTestAuthHeader(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono text-foreground outline-none focus:border-brand"
              placeholder="Authorization Header (e.g. Bearer token, optional)"
            />
          </div>

          {testResult && (
            <div
              className={`flex flex-wrap items-center justify-between rounded-lg border p-3.5 text-xs ${
                testResult.ok
                  ? 'border-success/30 bg-success/10 text-success'
                  : 'border-danger/30 bg-danger/10 text-danger'
              }`}
            >
              <div>
                <span className="font-bold">Status: {testResult.status}</span> ({testResult.statusText})
              </div>
              <div className="font-mono">
                Latency: <strong>{testResult.latencyMs} ms</strong>
              </div>
            </div>
          )}
        </form>
      </section>
    </main>
  );
}

