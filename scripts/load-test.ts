import "dotenv/config";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const base = process.env.API_URL ?? "http://localhost:3000";
const key = process.env.INGEST_API_KEY ?? "local-demo-key-change-me";
const total = Math.max(1, Math.min(100_000, Number(process.env.LOAD_EVENTS ?? 1000)));
const concurrency = Math.max(1, Math.min(100, Number(process.env.LOAD_CONCURRENCY ?? 20)));
const robotCount = Math.max(1, Math.min(1000, Number(process.env.LOAD_ROBOTS ?? 50)));
let cursor = 0;
let completed = 0;
let accepted = 0;
let overloaded = 0;
let failed = 0;
const latencies: number[] = [];
const start = performance.now();

async function client() {
  while (true) {
    const index = cursor++;
    if (index >= total) return;
    const began = performance.now();
    try {
      const response = await fetch(`${base}/api/telemetry`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key },
        body: JSON.stringify({
          eventId: randomUUID(),
          deviceId: `load-${String(index % robotCount).padStart(4, "0")}`,
          temperature: 20 + index % 15,
          battery: 30 + index % 70,
          timestamp: new Date().toISOString()
        }),
        signal: AbortSignal.timeout(10_000)
      });
      if (response.status === 202) accepted++;
      else if (response.status === 429) overloaded++;
      else failed++;
    } catch {
      failed++;
    } finally {
      latencies.push(performance.now() - began);
      completed++;
    }
  }
}

function percentile(p: number) {
  const sorted = [...latencies].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
}

await Promise.all(Array.from({ length: concurrency }, () => client()));
const elapsed = (performance.now() - start) / 1000;
console.log(JSON.stringify({
  attempted: completed, accepted, overloaded, failed, seconds: Number(elapsed.toFixed(2)),
  requestsPerSecond: Number((completed / elapsed).toFixed(1)),
  latencyMs: { p50: Math.round(percentile(0.5)), p95: Math.round(percentile(0.95)), p99: Math.round(percentile(0.99)) }
}, null, 2));
if (failed) process.exitCode = 1;
// This measures HTTP acceptance latency only, NOT worker persistence or WebSocket delivery.
