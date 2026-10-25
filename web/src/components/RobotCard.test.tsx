import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RobotCard from "./RobotCard";
import type { Robot } from "../telemetry";

const robot: Robot = {
  deviceId: "robot-001",
  temperature: 29.5,
  battery: 62,
  timestamp: "2026-01-01T12:00:00Z"
};
const timestamp = Date.parse(robot.timestamp);

describe("RobotCard", () => {
  it("renders readings and online status", () => {
    render(<RobotCard robot={robot} now={timestamp + 1_000} selected={false} onSelect={() => {}} />);
    expect(screen.getByText("robot-001")).toBeTruthy();
    expect(screen.getByText("29.5°C")).toBeTruthy();
    expect(screen.getByText("62%")).toBeTruthy();
    expect(screen.getByText("Online")).toBeTruthy();
  });

  it("renders offline state and calls selection handler", () => {
    const onSelect = vi.fn();
    render(<RobotCard robot={robot} now={timestamp + 11_000} selected={false} onSelect={onSelect} />);
    expect(screen.getByText("Offline")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith("robot-001");
  });
});
