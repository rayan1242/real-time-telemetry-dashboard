import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Server } from "socket.io";
import { createClient } from "redis";
import { createAdapter } from "@socket.io/redis-adapter";
import { z } from "zod";
import { pool, latestRobots, robotHistory, saveTelemetry } from "./db";
import { normalizeTelemetry, telemetrySchema } from "./schema";

const app = express();
const origin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
app.use(cors({ origin }));
app.use(express.json({ limit: "32kb" }));
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin }, transports: ["websocket"] });

function validKey(provided: unknown): boolean {
  const expected = process.env.INGEST_API_KEY;
  if (typeof provided !== "string" || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

app.get("/health", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (error) { next(error); }
});

app.get("/api/robots", async (_req, res, next) => {
  try { res.json({ items: await latestRobots() }); }
  catch (error) { next(error); }
});

app.get("/api/robots/:deviceId/history", async (req, res, next) => {
  const deviceId = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/).safeParse(req.params.deviceId);
  const limit = z.coerce.number().int().min(1).max(500).safeParse(req.query.limit ?? 100);
  if (!deviceId.success || !limit.success) {
    return res.status(400).json({ error: "Invalid deviceId or limit" });
  }
  try { return res.json({ items: await robotHistory(deviceId.data, limit.data) }); }
  catch (error) { return next(error); }
});

// Legacy path retained for callers of the original starter API.
app.get("/api/telemetry", async (_req, res, next) => {
  try { res.json({ items: await latestRobots() }); }
  catch (error) { next(error); }
});

app.post("/api/telemetry", async (req, res, next) => {
  if (!validKey(req.header("x-api-key"))) return res.status(401).json({ error: "Invalid ingestion API key" });
  const parsed = telemetrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid telemetry", details: parsed.error.flatten() });
  const event = normalizeTelemetry(parsed.data);
  try {
    const inserted = await saveTelemetry(event);
    if (inserted) {
      // The Redis adapter distributes this room broadcast across all Node instances.
      io.to(`robot:${event.deviceId}`).emit("telemetry", event);
    }
    return res.status(inserted ? 202 : 200).json({ event, duplicate: !inserted });
  } catch (error) { return next(error); }
});

io.on("connection", (socket) => {
  socket.on("watch", (deviceIds: unknown) => {
    if (!Array.isArray(deviceIds) || deviceIds.length > 100 ||
        deviceIds.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))) return;
    for (const room of socket.rooms) if (room.startsWith("robot:")) socket.leave(room);
    for (const id of deviceIds) socket.join(`robot:${id}`);
  });
});

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Request failed:", error);
  res.status(500).json({ error: "Internal server error" });
});

async function main() {
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL || !process.env.INGEST_API_KEY)
    throw new Error("DATABASE_URL, REDIS_URL, and INGEST_API_KEY are required");
  const pub = createClient({ url: process.env.REDIS_URL });
  const sub = pub.duplicate();
  pub.on("error", console.error);
  sub.on("error", console.error);
  await Promise.all([pub.connect(), sub.connect()]);
  io.adapter(createAdapter(pub, sub));
  await pool.query("SELECT 1");
  const port = Number(process.env.PORT ?? 3000);
  httpServer.listen(port, () => console.log(`API listening on http://localhost:${port}`));
}
main().catch((error) => { console.error(error); process.exit(1); });
