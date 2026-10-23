import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { z } from "zod";

const telemetrySchema = z.object({
  deviceId: z.string().min(1).max(100),
  temperature: z.number().finite().min(-100).max(300),
  battery: z.number().min(0).max(100),
  timestamp: z.string().datetime().optional(),
});

const app = express();
app.use(express.json({ limit: "32kb" }));
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173" } });
const recent: unknown[] = [];

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/telemetry", (_req, res) => res.json({ items: recent }));
app.post("/api/telemetry", (req, res) => {
  const parsed = telemetrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid telemetry", details: parsed.error.flatten() });
  const event = { ...parsed.data, timestamp: parsed.data.timestamp ?? new Date().toISOString() };
  recent.push(event);
  if (recent.length > 100) recent.shift();
  io.emit("telemetry", event);
  return res.status(202).json(event);
});

const port = Number(process.env.PORT ?? 3000);
httpServer.listen(port, () => console.log(`Telemetry API listening on http://localhost:${port}`));
