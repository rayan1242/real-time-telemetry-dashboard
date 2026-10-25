import { pool } from "./db";
import { z } from "zod";

const id = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const short = z.string().trim().min(1).max(120);
const optional = z.string().trim().max(120).default("");
const status = z.enum(["registered", "provisioned", "active", "retired"]);

export const registerDeviceSchema = z.object({
  deviceId: id,
  serialNumber: short,
  hardwareRevision: short,
  firmwareVersion: optional,
  customer: optional,
  status: status.default("registered")
}).strict();

export const updateDeviceSchema = registerDeviceSchema.omit({ deviceId: true }).partial().refine(
  value => Object.keys(value).length > 0, "At least one field is required"
);

export async function ensureDeviceTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS devices (
      device_id VARCHAR(100) PRIMARY KEY,
      serial_number VARCHAR(120) NOT NULL UNIQUE,
      hardware_revision VARCHAR(120) NOT NULL,
      firmware_version VARCHAR(120) NOT NULL DEFAULT '',
      customer VARCHAR(120) NOT NULL DEFAULT '',
      status VARCHAR(20) NOT NULL DEFAULT 'registered'
        CHECK (status IN ('registered','provisioned','active','retired')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS device_audit (
      id BIGSERIAL PRIMARY KEY,
      device_id VARCHAR(100) NOT NULL REFERENCES devices(device_id),
      action VARCHAR(40) NOT NULL,
      actor VARCHAR(120) NOT NULL,
      before_state JSONB,
      after_state JSONB NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS device_audit_device_time_idx
      ON device_audit (device_id, occurred_at DESC, id DESC);
  `);
}

const fields = `device_id AS "deviceId", serial_number AS "serialNumber",
  hardware_revision AS "hardwareRevision", firmware_version AS "firmwareVersion",
  customer, status, created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function listDevices() {
  const result = await pool.query(`SELECT ${fields} FROM devices ORDER BY device_id LIMIT 500`);
  return result.rows;
}

export async function registerDevice(data: z.infer<typeof registerDeviceSchema>, actor: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO devices (device_id, serial_number, hardware_revision, firmware_version, customer, status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${fields}`,
      [data.deviceId, data.serialNumber, data.hardwareRevision, data.firmwareVersion, data.customer, data.status]
    );
    const device = result.rows[0];
    await client.query(
      "INSERT INTO device_audit (device_id, action, actor, after_state) VALUES ($1,$2,$3,$4)",
      [data.deviceId, "registered", actor, JSON.stringify(device)]
    );
    await client.query("COMMIT");
    return device;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function updateDevice(deviceId: string, changes: z.infer<typeof updateDeviceSchema>, actor: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const previous = await client.query(`SELECT ${fields} FROM devices WHERE device_id=$1 FOR UPDATE`, [deviceId]);
    if (!previous.rows.length) { await client.query("ROLLBACK"); return null; }
    const before = previous.rows[0];
    const next = { ...before, ...changes };
    const updated = await client.query(
      `UPDATE devices SET serial_number=$2, hardware_revision=$3, firmware_version=$4,
       customer=$5, status=$6, updated_at=NOW() WHERE device_id=$1 RETURNING ${fields}`,
      [deviceId, next.serialNumber, next.hardwareRevision, next.firmwareVersion, next.customer, next.status]
    );
    const after = updated.rows[0];
    await client.query(
      "INSERT INTO device_audit (device_id, action, actor, before_state, after_state) VALUES ($1,$2,$3,$4,$5)",
      [deviceId, "updated", actor, JSON.stringify(before), JSON.stringify(after)]
    );
    await client.query("COMMIT");
    return after;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function deviceAudit(deviceId: string) {
  const result = await pool.query(
    `SELECT id::text, device_id AS "deviceId", action, actor,
      before_state AS "beforeState", after_state AS "afterState", occurred_at AS "occurredAt"
      FROM device_audit WHERE device_id=$1 ORDER BY occurred_at DESC, id DESC LIMIT 100`,
    [deviceId]
  );
  return result.rows;
}
