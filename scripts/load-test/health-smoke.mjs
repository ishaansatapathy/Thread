/**
 * Lightweight load smoke test — run against a running API:
 *   node scripts/load-test/health-smoke.mjs http://localhost:8000
 */

const baseUrl = process.argv[2]?.replace(/\/$/, "") ?? "http://localhost:8000";
const concurrency = 20;
const requests = 100;

async function hitHealth() {
  const start = performance.now();
  const res = await fetch(`${baseUrl}/health`);
  const ms = performance.now() - start;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ms;
}

async function runPool(tasks) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < tasks) {
      const i = index++;
      try {
        results[i] = await hitHealth();
      } catch (error) {
        results[i] = -1;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

const latencies = await runPool(requests);
const ok = latencies.filter((v) => v >= 0);
const failed = latencies.length - ok.length;
const sorted = [...ok].sort((a, b) => a - b);
const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;

console.log(JSON.stringify({
  baseUrl,
  requests,
  concurrency,
  ok: ok.length,
  failed,
  p95Ms: Math.round(p95),
  avgMs: ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : 0,
}, null, 2));

if (failed > 0) process.exit(1);
