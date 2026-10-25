import { describe, expect, it } from "vitest";
import { isOnline, merge, timeLabel, type Robot } from "./telemetry";

const reading = (timestamp: string, temperature = 25): Robot => ({
  deviceId: "robot-001",
  temperature,
  battery: 75,
  timestamp
});

describe("telemetry state helpers", () => {
  it("adds a new robot and replaces it with a newer reading", () => {
    const first = merge({}, reading("2026-01-01T12:00:00Z"));
    const second = merge(first, reading("2026-01-01T12:00:02Z", 31));
    expect(second["robot-001"].temperature).toBe(31);
  });

  it("ignores out-of-order readings without changing state identity", () => {
    const latest = merge({}, reading("2026-01-01T12:00:02Z", 31));
    expect(merge(latest, reading("2026-01-01T12:00:01Z", 20))).toBe(latest);
  });

  it("marks a robot offline after the 10-second threshold", () => {
    const robot = reading("2026-01-01T12:00:00Z");
    const at = Date.parse(robot.timestamp);
    expect(isOnline(robot, at + 9_999)).toBe(true);
    expect(isOnline(robot, at + 10_000)).toBe(false);
  });

  it("returns a safe label for an invalid timestamp", () => {
    expect(timeLabel("invalid")).toBe("Unknown");
  });
});
