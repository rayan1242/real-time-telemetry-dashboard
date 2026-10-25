import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { dashboardAuthorized, requireDashboard, validDeviceKey } from "./auth";
import { Server } from "socket.io";
import { createClient } from "redis";
import { enqueueTelemetry, redisClient, UPDATE_CHANNEL, STREAM, GROUP } from "./queue";
import { createAdapter } from "@socket.io/redis-adapter";
import { z } from "zod";
import { pool, latestRobots, robotHistory } from "./db";
import { normalizeTelemetry, telemetrySchema } from "./schema";
import { ensureDeviceTables, listDevices, registerDevice, updateDevice, deviceAudit, registerDeviceSchema, updateDeviceSchema } from "./devices";

const app = express();
const origin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
app.use(cors({ origin }));
app.use(express.json({ limit: "32kb" }));
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin }, transports: ["websocket"] });
let ready = false;
let shuttingDown = false;
const maxQueueLag = Number(process.env.MAX_QUEUE_LAG ?? 5000);

async function queueStats() {
  if (!redisQueue?.isReady) throw new Error("Redis queue unavailable");
  if (!(await redisQueue.exists(STREAM))) return { streamEntries: 0, pending: 0, lag: null };
  const [length, groups] = await Promise.all([redisQueue.xLen(STREAM), redisQueue.xInfoGroups(STREAM)]);
  const group = groups.find(item => item.name === GROUP);
  return { streamEntries: length, pending: group?.pending ?? 0, lag: group?.lag ?? null };
}


app.get("/live", (_req, res) => res.json({ status: "alive" }));

app.get("/health", async (_req, res, next) => {
  if (!ready || shuttingDown) return res.status(503).json({ status: "unavailable" });
  try {
    await Promise.all([pool.query("SELECT 1"), redisQueue?.ping() ?? Promise.reject(new Error("Redis not ready"))]);
    res.json({ status: "ok" });
  } catch (error) { next(error); }
});

app.get("/api/ops/queue", requireDashboard, async (_req, res, next) => {
  try { res.json(await queueStats()); }
  catch (error) { next(error); }
});


// Demo operator identity is shared: audit actor is a label, not an authenticated person.
const auditActor = "dashboard-operator";
const deviceIdSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
function deviceError(error: unknown, res: express.Response, next: express.NextFunction) {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
    res.status(409).json({ error: "Device ID or serial number already exists" });
    return;
  }
  next(error);
}

app.get("/api/devices", requireDashboard, async (_req, res, next) => {
  try { res.json({ items: await listDevices() }); } catch (error) { next(error); }
});

app.post("/api/devices", requireDashboard, async (req, res, next) => {
  const parsed = registerDeviceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid device registration", details: parsed.error.flatten() });
  try { return res.status(201).json({ device: await registerDevice(parsed.data, auditActor) }); }
  catch (error) { return deviceError(error, res, next); }
});

app.patch("/api/devices/:deviceId", requireDashboard, async (req, res, next) => {
  const deviceId = deviceIdSchema.safeParse(req.params.deviceId);
  const parsed = updateDeviceSchema.safeParse(req.body);
  if (!deviceId.success || !parsed.success) return res.status(400).json({ error: "Invalid device update" });
  try {
    const device = await updateDevice(deviceId.data, parsed.data, auditActor);
    return device ? res.json({ device }) : res.status(404).json({ error: "Device not found" });
  } catch (error) { return deviceError(error, res, next); }
});

app.get("/api/devices/:deviceId/audit", requireDashboard, async (req, res, next) => {
  const deviceId = deviceIdSchema.safeParse(req.params.deviceId);
  if (!deviceId.success) return res.status(400).json({ error: "Invalid device ID" });
  try { return res.json({ items: await deviceAudit(deviceId.data) }); }
  catch (error) { return next(error); }
});

app.get("/api/robots", requireDashboard, async (_req, res, next) => {
  try { res.json({ items: await latestRobots() }); }
  catch (error) { next(error); }
});

app.get("/api/robots/:deviceId/history", requireDashboard, async (req, res, next) => {
  const deviceId = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/).safeParse(req.params.deviceId);
  const limit = z.coerce.number().int().min(1).max(500).safeParse(req.query.limit ?? 100);
  if (!deviceId.success || !limit.success) {
    return res.status(400).json({ error: "Invalid deviceId or limit" });
  }
  try { return res.json({ items: await robotHistory(deviceId.data, limit.data) }); }
  catch (error) { return next(error); }
});

// Legacy path retained for callers of the original starter API.
app.get("/api/telemetry", requireDashboard, async (_req, res, next) => {
  try { res.json({ items: await latestRobots() }); }
  catch (error) { next(error); }
});

app.post("/api/telemetry", async (req, res, next) => {
  if (shuttingDown) return res.status(503).json({ error: "Server is shutting down" });
  const parsed = telemetrySchema.safeParse(req.body);
  // Authenticate before accepting an event; never authorize a device for another ID.
  if (!parsed.success) return res.status(400).json({ error: "Invalid telemetry", details: parsed.error.flatten() });
  if (!validDeviceKey(req.header("x-api-key"), parsed.data.deviceId))
    return res.status(401).json({ error: "Invalid device API key" });
  const event = normalizeTelemetry(parsed.data);
  try {
    if (!redisQueue?.isReady) return res.status(503).json({ error: "Queue unavailable" });
    // Reject excessive *undelivered* backlog without trimming unprocessed events.
    // XINFO lag is approximate; this is admission control, not a hard queue cap.
    if (Number.isFinite(maxQueueLag) && maxQueueLag > 0) {
      const { lag } = await queueStats();
      if (lag !== null && lag >= maxQueueLag) {
        res.setHeader("Retry-After", "2");
        return res.status(429).json({ error: "Queue overloaded; retry later" });
      }
    }
    const queueId = await enqueueTelemetry(redisQueue, event);
    return res.status(202).json({ event, queueId, status: "queued" });
  } catch (error) { return next(error); }
});

io.use((socket, next) => {
  if (!dashboardAuthorized(socket.handshake.auth?.token)) {
    next(new Error("Unauthorized dashboard connection"));
    return;
  }
  next();
});

io.on("connection", (socket) => {
  socket.on("watch", (deviceIds: unknown, acknowledge?: (result: { ok: boolean }) => void) => {
    if (!Array.isArray(deviceIds) || deviceIds.length > 100 ||
        deviceIds.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))) {
      acknowledge?.({ ok: false });
      return;
    }
    for (const room of socket.rooms) if (room.startsWith("robot:")) socket.leave(room);
    for (const id of deviceIds) socket.join(`robot:${id}`);
    acknowledge?.({ ok: true });
  });
});

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Request failed:", error);
  res.status(500).json({ error: "Internal server error" });
});

let redisPub: ReturnType<typeof createClient> | undefined;
let redisSub: ReturnType<typeof createClient> | undefined;
let redisQueue: ReturnType<typeof createClient> | undefined;
let redisUpdates: ReturnType<typeof createClient> | undefined;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  ready = false;
  console.log(`Received ${signal}; draining connections`);
  const deadline = setTimeout(() => {
    console.error("Graceful shutdown timed out");
    process.exit(1);
  }, 10000);
  deadline.unref();
  try {
    // Socket.IO closes WebSocket connections and the underlying HTTP server.
    // The readiness endpoint already rejects new traffic during draining.
    io.disconnectSockets(true);
    await new Promise<void>(resolve => io.close(() => resolve()));
    if (redisUpdates?.isOpen) await redisUpdates.quit();
    if (redisQueue?.isOpen) await redisQueue.quit();
    if (redisPub?.isOpen) await redisPub.quit();
    if (redisSub?.isOpen) await redisSub.quit();
    await pool.end();
    clearTimeout(deadline);
    process.exit(0);
  } catch (error) {
    console.error("Shutdown failed", error);
    process.exit(1);
  }
}

process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });

async function main() {
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL || !process.env.DASHBOARD_TOKEN ||
      (!process.env.INGEST_API_KEY && !process.env.DEVICE_API_KEYS))
    throw new Error("DATABASE_URL, REDIS_URL, DASHBOARD_TOKEN, and an ingestion credential are required");
  const pub = createClient({ url: process.env.REDIS_URL });
  const sub = pub.duplicate();
  pub.on("error", console.error);
  sub.on("error", console.error);
  const queue = redisClient();
  const updates = redisClient();
  await Promise.all([pub.connect(), sub.connect(), queue.connect(), updates.connect()]);
  redisQueue = queue;
  redisUpdates = updates;
  await updates.subscribe(UPDATE_CHANNEL, payload => {
    try {
      const parsed = telemetrySchema.safeParse(JSON.parse(payload));
      if (!parsed.success) return;
      const event = normalizeTelemetry(parsed.data);
      // Every API instance receives this Pub/Sub message; emit to local sockets
      // only, otherwise the Socket.IO Redis adapter multiplies broadcasts.
      io.local.to(`robot:${event.deviceId}`).emit("telemetry", event);
    } catch (error) { console.error("Invalid worker notification:", error); }
  });
  redisPub = pub;
  redisSub = sub;
  io.adapter(createAdapter(pub, sub));
  await pool.query("SELECT 1");
  await ensureDeviceTables();
  const port = Number(process.env.PORT ?? 3000);
  httpServer.listen(port, () => {
    ready = true;
    console.log(`API listening on http://localhost:${port}`);
  });
}
main().catch((error) => { console.error(error); process.exit(1); });
