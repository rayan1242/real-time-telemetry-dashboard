import assert from "node:assert/strict";
import test from "node:test";
import { registerDeviceSchema, updateDeviceSchema } from "../src/devices";

test("registration requires a device identity and hardware metadata", () => {
  assert.equal(registerDeviceSchema.safeParse({
    deviceId: "robot-001", serialNumber: "SN-0001", hardwareRevision: "rev-A"
  }).success, true);
  assert.equal(registerDeviceSchema.safeParse({
    deviceId: "robot-001", serialNumber: "", hardwareRevision: "rev-A"
  }).success, false);
  assert.equal(registerDeviceSchema.safeParse({
    deviceId: "../other", serialNumber: "SN-0001", hardwareRevision: "rev-A"
  }).success, false);
});

test("updates accept supported metadata and reject unknown fields", () => {
  assert.equal(updateDeviceSchema.safeParse({ status: "active" }).success, true);
  assert.equal(updateDeviceSchema.safeParse({ firmwareVersion: "1.2.3" }).success, true);
  assert.equal(updateDeviceSchema.safeParse({}).success, false);
  assert.equal(updateDeviceSchema.safeParse({ admin: true }).success, false);
  assert.equal(updateDeviceSchema.safeParse({ status: "untrusted" }).success, false);
});
