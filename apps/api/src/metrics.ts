/**
 * Lightweight in-process metrics store.
 *
 * Tracks:
 *  - request counts per route (2xx / 4xx / 5xx)
 *  - latency histograms (p50 / p95 / p99) per route
 *  - queue approve / dismiss events
 *  - Gmail / Calendar API call counts + errors
 *
 * No external dependency — pure in-memory ring buffer per route.
 * Exposed via GET /metrics (plaintext Prometheus-compatible) and
 * GET /metrics/json (structured JSON for dashboards / health pages).
 */

import { incrementSharedCounter, getSharedCounters, getSharedCountersMerged } from "@repo/services/observability/counters";

const LATENCY_BUCKET_COUNT = 512;

type LatencyBucket = {
  samples: number[];
  head: number;
  count: number;
};

type RouteStats = {
  requests: number;
  ok: number;
  clientError: number;
  serverError: number;
  latency: LatencyBucket;
};

type CounterMap = Map<string, number>;

const routes = new Map<string, RouteStats>();
const counters: CounterMap = new Map();

function getOrCreate(route: string): RouteStats {
  let s = routes.get(route);
  if (!s) {
    s = {
      requests: 0,
      ok: 0,
      clientError: 0,
      serverError: 0,
      // Use -1 as sentinel for "empty slot" so genuine 0ms responses aren't filtered.
      latency: { samples: new Array<number>(LATENCY_BUCKET_COUNT).fill(-1), head: 0, count: 0 },
    };
    routes.set(route, s);
  }
  return s;
}

export function recordRequest(route: string, statusCode: number, durationMs: number) {
  const s = getOrCreate(route);
  s.requests += 1;
  if (statusCode < 400) s.ok += 1;
  else if (statusCode < 500) s.clientError += 1;
  else s.serverError += 1;

  const b = s.latency;
  b.samples[b.head] = durationMs;
  b.head = (b.head + 1) % LATENCY_BUCKET_COUNT;
  b.count += 1;
}

export function incrementCounter(name: string, by = 1) {
  counters.set(name, (counters.get(name) ?? 0) + by);
  incrementSharedCounter(name, by);
}

function percentile(samples: number[], count: number, p: number): number {
  if (count === 0) return 0;
  // -1 is the sentinel for empty ring-buffer slots; genuine 0ms entries are valid.
  const filled = samples.filter((v) => v >= 0);
  if (filled.length === 0) return 0;
  const sorted = [...filled].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[idx]!);
}

export type RouteSnapshot = {
  route: string;
  requests: number;
  ok: number;
  clientError: number;
  serverError: number;
  errorRate: string;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
};

export function snapshot(): { routes: RouteSnapshot[]; counters: Record<string, number> } {
  const routeSnaps: RouteSnapshot[] = [];
  for (const [route, s] of routes) {
    const total = s.requests;
    const errors = s.clientError + s.serverError;
    routeSnaps.push({
      route,
      requests: total,
      ok: s.ok,
      clientError: s.clientError,
      serverError: s.serverError,
      errorRate: total > 0 ? `${((errors / total) * 100).toFixed(1)}%` : "0%",
      p50Ms: percentile(s.latency.samples, s.latency.count, 50),
      p95Ms: percentile(s.latency.samples, s.latency.count, 95),
      p99Ms: percentile(s.latency.samples, s.latency.count, 99),
    });
  }
  routeSnaps.sort((a, b) => b.requests - a.requests);

  return { routes: routeSnaps, counters: getSharedCounters() };
}

export async function snapshotMerged(): Promise<{ routes: RouteSnapshot[]; counters: Record<string, number> }> {
  const base = snapshot();
  return { routes: base.routes, counters: await getSharedCountersMerged() };
}

/** Prometheus-compatible plaintext format. */
export function toPrometheusText(): string {
  const { routes: snaps, counters: ctrs } = snapshot();
  const lines: string[] = ["# Thread API metrics\n"];

  for (const s of snaps) {
    const label = `route="${s.route}"`;
    lines.push(`thread_requests_total{${label}} ${s.requests}`);
    lines.push(`thread_requests_ok{${label}} ${s.ok}`);
    lines.push(`thread_requests_error{${label}} ${s.clientError + s.serverError}`);
    lines.push(`thread_latency_p50_ms{${label}} ${s.p50Ms}`);
    lines.push(`thread_latency_p95_ms{${label}} ${s.p95Ms}`);
    lines.push(`thread_latency_p99_ms{${label}} ${s.p99Ms}`);
  }

  lines.push("");
  for (const [k, v] of Object.entries(ctrs)) {
    lines.push(`thread_counter{name="${k}"} ${v}`);
  }

  return lines.join("\n");
}
