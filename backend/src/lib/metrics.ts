/**
 * In-process counters, exposed in Prometheus text format.
 *
 * Deliberately not a metrics library: this records the handful of numbers that
 * actually indicate trouble here — request volume by outcome, latency buckets,
 * and how often the caches are earning their keep.
 *
 * Counters are per-instance and reset on deploy. That is normal for Prometheus,
 * which computes rates across scrapes rather than trusting absolute totals.
 */
const counters = new Map<string, number>();
const histograms = new Map<string, number[]>();

/** Latency buckets in milliseconds, chosen around the thresholds we care about. */
const BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500];

function labelKey(name: string, labels: Record<string, string>): string {
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v.replace(/"/g, '')}"`);
  return parts.length ? `${name}{${parts.join(',')}}` : name;
}

export function increment(name: string, labels: Record<string, string> = {}, by = 1): void {
  const key = labelKey(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + by);
}

export function observe(name: string, ms: number, labels: Record<string, string> = {}): void {
  const key = labelKey(name, labels);
  const series = histograms.get(key) ?? [];
  // Bounded so a long-running instance cannot grow this without limit.
  if (series.length >= 5000) series.shift();
  series.push(ms);
  histograms.set(key, series);
}

export function render(): string {
  const lines: string[] = [];

  if (counters.size) {
    lines.push('# TYPE skyup_requests_total counter');
    for (const [key, value] of counters) lines.push(`${key} ${value}`);
  }

  for (const [key, series] of histograms) {
    const name = key.split('{')[0]!;
    const labelPart = key.includes('{') ? key.slice(key.indexOf('{') + 1, -1) : '';
    const withLabel = (extra: string) =>
      labelPart ? `${name}_bucket{${labelPart},${extra}}` : `${name}_bucket{${extra}}`;

    lines.push(`# TYPE ${name} histogram`);
    const sorted = [...series].sort((a, b) => a - b);
    for (const bucket of BUCKETS) {
      const count = sorted.filter((v) => v <= bucket).length;
      lines.push(`${withLabel(`le="${bucket}"`)} ${count}`);
    }
    lines.push(`${withLabel('le="+Inf"')} ${sorted.length}`);
    lines.push(`${name}_sum${labelPart ? `{${labelPart}}` : ''} ${sorted.reduce((a, b) => a + b, 0)}`);
    lines.push(`${name}_count${labelPart ? `{${labelPart}}` : ''} ${sorted.length}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * p50/p95/p99 for the health endpoint, which is read by humans not scrapers.
 *
 * Aggregates across every label combination: observations are stored per
 * route+method, so looking up the bare metric name alone finds nothing.
 */
export function percentiles(name: string): { p50: number; p95: number; p99: number; count: number } {
  const merged: number[] = [];
  for (const [key, values] of histograms) {
    if (key === name || key.startsWith(`${name}{`)) merged.push(...values);
  }
  const series = merged.sort((a, b) => a - b);
  if (!series.length) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const at = (q: number) => series[Math.min(series.length - 1, Math.floor(series.length * q))]!;
  return {
    p50: Math.round(at(0.5) * 100) / 100,
    p95: Math.round(at(0.95) * 100) / 100,
    p99: Math.round(at(0.99) * 100) / 100,
    count: series.length,
  };
}
