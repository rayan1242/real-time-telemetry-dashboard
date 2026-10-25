import { createClient } from "redis";
import type { TelemetryEvent } from "./schema";

export const STREAM = "telemetry:events";
export const DEAD_LETTER_STREAM = "telemetry:dead-letter";
export const UPDATE_CHANNEL = "telemetry:processed";
export const GROUP = "telemetry-workers";
export const ATTEMPTS_HASH = "telemetry:attempts";

export function redisClient() {
  const client = createClient({ url: process.env.REDIS_URL });
  client.on("error", error => console.error("Redis error:", error));
  return client;
}

export async function enqueueTelemetry(
  client: ReturnType<typeof redisClient>,
  event: TelemetryEvent
): Promise<string> {
  // XADD returns a stream ID. A successful 202 means Redis accepted the event,
  // NOT that PostgreSQL has already persisted it.
  return client.xAdd(STREAM, "*", { event: JSON.stringify(event) });
}
