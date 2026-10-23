import "dotenv/config";
import { randomUUID } from "node:crypto";

const url = process.env.API_URL ?? "http://localhost:3000";
const apiKey = process.env.INGEST_API_KEY ?? "local-demo-key-change-me";
const ids = Array.from({ length: 12 }, (_, i) => `robot-${String(i + 1).padStart(3, "0")}`);

async function tick() {
  const events = ids.map(async (deviceId, i) => {
    const response = await fetch(`${url}/api/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        eventId: randomUUID(),
        deviceId,
        temperature: Math.round((20 + i + Math.random() * 5) * 10) / 10,
        battery: Math.max(0, Math.round(90 - i * 3 - Math.random() * 10)),
        timestamp: new Date().toISOString()
      })
    });
    if (!response.ok) throw new Error(`${deviceId}: HTTP ${response.status}`);
  });
  await Promise.all(events);
  console.log(`Sent ${ids.length} robot updates at ${new Date().toLocaleTimeString()}`);
}

async function main() {
  while (true) {
    try { await tick(); } catch (error) { console.error(error); }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
void main();
