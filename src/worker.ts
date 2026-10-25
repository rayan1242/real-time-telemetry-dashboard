import "dotenv/config";
import { randomUUID } from "node:crypto";
import { saveTelemetry, pool } from "./db";
import { telemetrySchema, normalizeTelemetry } from "./schema";
import {
  redisClient, STREAM, GROUP, DEAD_LETTER_STREAM, UPDATE_CHANNEL, ATTEMPTS_HASH
} from "./queue";

const consumer = `worker-${randomUUID().slice(0, 8)}`;
const MAX_ATTEMPTS = 5;
const CLAIM_AFTER_MS = 10_000;
const client = redisClient();
let stopping = false;

type StreamMessage = { id: string; message: Record<string, string> };

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function ensureGroup() {
  try {
    await client.xGroupCreate(STREAM, GROUP, "0", { MKSTREAM: true });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) throw error;
  }
}

async function handle(item: StreamMessage) {
  try {
    const raw = JSON.parse(item.message.event ?? "");
    const parsed = telemetrySchema.safeParse(raw);
    if (!parsed.success) throw new Error("Invalid queued telemetry payload");
    const event = normalizeTelemetry(parsed.data);

    // The DB uses event_id as a unique key: replay after a crash is safe.
    await saveTelemetry(event);

    // Publish even for a duplicate. If a worker crashed after the DB commit
    // but before publish, replay must still notify live clients.
    // WebSocket delivery is at-least-once; clients deduplicate by event ID.
    await client.publish(UPDATE_CHANNEL, JSON.stringify(event));
    await client.xAck(STREAM, GROUP, item.id);
    await client.hDel(ATTEMPTS_HASH, item.id);
  } catch (error) {
    const attempts = await client.hIncrBy(ATTEMPTS_HASH, item.id, 1);
    console.error(`Event ${item.id} failed (attempt ${attempts})`, error);
    if (attempts >= MAX_ATTEMPTS) {
      // DLQ write happens before acknowledgement: failure to write the DLQ
      // leaves the original event pending for another retry.
      await client.xAdd(DEAD_LETTER_STREAM, "*", {
        originalId: item.id,
        payload: item.message.event ?? "",
        reason: error instanceof Error ? error.message.slice(0, 500) : String(error),
        failedAt: new Date().toISOString()
      });
      await client.xAck(STREAM, GROUP, item.id);
      await client.hDel(ATTEMPTS_HASH, item.id);
      console.error(`Moved ${item.id} to dead-letter stream`);
    }
  }
}

async function reclaimPending() {
  // A crashed worker leaves messages in the pending entries list (PEL).
  // XAUTOCLAIM transfers stale pending messages to this worker.
  const response = await client.sendCommand([
    "XAUTOCLAIM", STREAM, GROUP, consumer,
    String(CLAIM_AFTER_MS), "0-0", "COUNT", "20"
  ]) as unknown as [string, Array<[string, string[]]>];
  for (const [id, fields] of response[1] ?? []) {
    const message: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) message[fields[i]] = fields[i + 1];
    await handle({ id, message });
    if (stopping) return;
  }
}

async function main() {
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL)
    throw new Error("DATABASE_URL and REDIS_URL are required");
  await client.connect();
  await ensureGroup();
  console.log(`Telemetry worker ${consumer} started`);

  while (!stopping) {
    try {
      await reclaimPending();
      if (stopping) break;
      const result = await client.xReadGroup(
        GROUP, consumer, { key: STREAM, id: ">" },
        { COUNT: 20, BLOCK: 2000 }
      );
      for (const stream of result ?? []) {
        for (const item of stream.messages) {
          await handle(item);
          if (stopping) break;
        }
      }
    } catch (error) {
      if (stopping) break;
      console.error("Worker loop error:", error);
      await delay(1000);
    }
  }
  await client.quit();
  await pool.end();
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => { console.log(`Received ${signal}; finishing current event`); stopping = true; });
}

main().catch(error => { console.error("Worker fatal error:", error); process.exitCode = 1; });
