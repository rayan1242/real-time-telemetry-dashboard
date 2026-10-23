import { Pool } from "pg";
import type { TelemetryEvent } from "./schema";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function saveTelemetry(event: TelemetryEvent): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Unique event IDs make retries safe. A duplicate must not update latest state.
    const inserted = await client.query(
      `INSERT INTO telemetry_events (event_id, device_id, temperature, battery, recorded_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [event.eventId, event.deviceId, event.temperature, event.battery, event.timestamp]
    );
    if (inserted.rowCount) {
      await client.query(
        `INSERT INTO robot_latest (device_id, temperature, battery, recorded_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (device_id) DO UPDATE SET
           temperature = EXCLUDED.temperature,
           battery = EXCLUDED.battery,
           recorded_at = EXCLUDED.recorded_at
         WHERE robot_latest.recorded_at <= EXCLUDED.recorded_at`,
        [event.deviceId, event.temperature, event.battery, event.timestamp]
      );
    }
    await client.query("COMMIT");
    return Boolean(inserted.rowCount);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function latestRobots() {
  const result = await pool.query(
    `SELECT device_id AS "deviceId", temperature, battery,
            recorded_at AS "timestamp"
     FROM robot_latest ORDER BY device_id LIMIT 500`
  );
  return result.rows;
}

export async function robotHistory(deviceId: string, limit: number) {
  const result = await pool.query(
    `SELECT event_id AS "eventId", device_id AS "deviceId",
            temperature, battery, recorded_at AS "timestamp"
     FROM telemetry_events WHERE device_id = $1
     ORDER BY recorded_at DESC LIMIT $2`,
    [deviceId, limit]
  );
  return result.rows.reverse();
}
