import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const base = process.env.API_URL ?? "http://localhost:3000";
const token = process.env.DASHBOARD_TOKEN ?? "local-dashboard-token-change-me";

async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(base + path, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...init.headers }
  });
  return { status: response.status, body: await response.json() };
}

test("provisioning records device identity and transactional audit history", async () => {
  const id = "reg-" + randomUUID().slice(0, 8);
  const serial = "SN-" + randomUUID();
  const unauthorized = await fetch(base + "/api/devices");
  assert.equal(unauthorized.status, 401);
  const created = await call("/api/devices", {
    method: "POST", body: JSON.stringify({ deviceId: id, serialNumber: serial, hardwareRevision: "rev-A", firmwareVersion: "1.0.0" })
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.device.serialNumber, serial);
  const duplicate = await call("/api/devices", {
    method: "POST", body: JSON.stringify({ deviceId: "another-" + id, serialNumber: serial, hardwareRevision: "rev-A" })
  });
  assert.equal(duplicate.status, 409);
  const updated = await call(`/api/devices/${id}`, {
    method: "PATCH", body: JSON.stringify({ status: "provisioned", customer: "Demo Lab" })
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.device.status, "provisioned");
  const listing = await call("/api/devices");
  assert.equal(listing.status, 200);
  assert.ok(listing.body.items.some((item: any) => item.deviceId === id));
  const audit = await call(`/api/devices/${id}/audit`);
  assert.equal(audit.status, 200);
  assert.equal(audit.body.items.length, 2);
  assert.deepEqual(audit.body.items.map((item: any) => item.action), ["updated", "registered"]);
  assert.equal(audit.body.items[0].beforeState.status, "registered");
  assert.equal(audit.body.items[0].afterState.status, "provisioned");
  assert.equal(audit.body.items[0].actor, "dashboard-operator");
});
