import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { io } from "socket.io-client";

const base = process.env.API_URL ?? "http://localhost:3000";
const apiKey = process.env.INGEST_API_KEY ?? "local-demo-key-change-me";

async function request(path: string, init?: RequestInit) {
  const response = await fetch(base + path, init);
  return { response, body: await response.json() };
}

async function send(event: Record<string, unknown>) {
  return request("/api/telemetry", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(event)
  });
}

async function eventually<T>(fn: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 10000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("Timed out waiting for asynchronous worker processing");
}

test("Queue, PostgreSQL idempotency, ordering and WebSocket delivery", { timeout: 25000 }, async () => {
  const live = await request("/live");
  assert.equal(live.response.status, 200);
  const health = await request("/health");
  assert.equal(health.response.status, 200);

  const deviceId = "test-" + randomUUID().slice(0, 8);
  const eventId = randomUUID();
  const socket = io(base, { transports: ["websocket"], reconnection: false, autoConnect: false });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Socket connection timed out")), 5000);
      socket.once("connect", () => { clearTimeout(timer); resolve(); });
      socket.once("connect_error", error => { clearTimeout(timer); reject(error); });
      socket.connect();
    });
    const subscribed = await new Promise<{ ok: boolean }>((resolve, reject) => {
      socket.timeout(3000).emit("watch", [deviceId], (error: Error | null, result: { ok: boolean }) => error ? reject(error) : resolve(result));
    });
    assert.equal(subscribed.ok, true);
    const received = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WebSocket event timed out")), 5000);
      socket.once("telemetry", event => { clearTimeout(timer); resolve(event); });
    });

    const timestamp = new Date().toISOString();
    const event = { eventId, deviceId, temperature: 25, battery: 80, timestamp };
    const first = await send(event);
    assert.equal(first.response.status, 202);
    assert.equal(first.body.status, "queued");
    assert.ok(first.body.queueId);
    assert.equal((await received).eventId, eventId);

    const duplicate = await send(event);
    assert.equal(duplicate.response.status, 202);

    const old = await send({
      ...event,
      eventId: randomUUID(),
      temperature: 5,
      timestamp: new Date(Date.parse(timestamp) - 60000).toISOString()
    });
    assert.equal(old.response.status, 202);

    const robots = await eventually(() => request("/api/robots"), result =>
      result.body.items.some((item: any) => item.deviceId === deviceId && item.temperature === 25));
    assert.equal(robots.response.status, 200);
    const latest = robots.body.items.find((item: any) => item.deviceId === deviceId);
    assert.equal(latest.temperature, 25, "Older event must not overwrite latest state");

    const history = await eventually(() => request(`/api/robots/${deviceId}/history`), result =>
      result.body.items.length === 2);
    assert.equal(history.response.status, 200);
    assert.equal(history.body.items.length, 2, "Duplicate must not add a third event");

    const unauthorized = await request("/api/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...event, eventId: randomUUID() })
    });
    assert.equal(unauthorized.response.status, 401);
  } finally {
    socket.disconnect();
  }
});
