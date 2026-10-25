import { describe, expect, it } from "vitest";
import { alertsForRobot } from "./alerts";
import type { Robot } from "./telemetry";

const robot: Robot = { deviceId: "robot-001", temperature: 25, battery: 80, timestamp: "2026-01-01T00:00:00Z" };

describe("robot alerts", () => {
  it("reports both high temperature and low battery", () => {
    expect(alertsForRobot({ ...robot, temperature: 35, battery: 20 }).map(alert => alert.kind))
      .toEqual(["temperature", "battery"]);
  });
  it("does not alert for healthy readings", () => {
    expect(alertsForRobot(robot)).toEqual([]);
  });
});
