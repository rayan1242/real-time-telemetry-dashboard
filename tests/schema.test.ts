import assert from "node:assert/strict";
import test from "node:test";
import { telemetrySchema, normalizeTelemetry } from "../src/schema";

const valid = { eventId: "11111111-1111-4111-8111-111111111111", deviceId: "robot-001", temperature: 22, battery: 85 };

test("accepts a valid telemetry event", () => {
  assert.equal(telemetrySchema.safeParse(valid).success, true);
});

test("rejects out-of-range battery", () => {
  assert.equal(telemetrySchema.safeParse({ ...valid, battery: 120 }).success, false);
});

test("rejects invalid robot identifiers", () => {
  assert.equal(telemetrySchema.safeParse({ ...valid, deviceId: "../admin" }).success, false);
});

test("fills missing timestamps", () => {
  const event = normalizeTelemetry(valid);
  assert.ok(!Number.isNaN(Date.parse(event.timestamp)));
});
