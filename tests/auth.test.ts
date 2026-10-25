import assert from "node:assert/strict";
import test from "node:test";
import { dashboardAuthorized, secureEqual, validDeviceKey } from "../src/auth";

test("constant-time token comparison handles missing and incorrect credentials", () => {
  assert.equal(secureEqual(undefined, "abc"), false);
  assert.equal(secureEqual("wrong", "abc"), false);
  assert.equal(secureEqual("abc", "abc"), true);
});

test("operator credential is separate from ingestion credential", () => {
  const old = process.env.DASHBOARD_TOKEN;
  try {
    process.env.DASHBOARD_TOKEN = "operator-secret";
    assert.equal(dashboardAuthorized("operator-secret"), true);
    assert.equal(dashboardAuthorized("robot-secret"), false);
  } finally {
    if (old === undefined) delete process.env.DASHBOARD_TOKEN;
    else process.env.DASHBOARD_TOKEN = old;
  }
});

test("per-device credentials cannot be used for another robot", () => {
  const old = process.env.DEVICE_API_KEYS;
  try {
    process.env.DEVICE_API_KEYS = JSON.stringify({
      "robot-001": "key-one",
      "robot-002": "key-two"
    });
    assert.equal(validDeviceKey("key-one", "robot-001"), true);
    assert.equal(validDeviceKey("key-one", "robot-002"), false);
    assert.equal(validDeviceKey("key-two", "robot-002"), true);
  } finally {
    if (old === undefined) delete process.env.DEVICE_API_KEYS;
    else process.env.DEVICE_API_KEYS = old;
  }
});
