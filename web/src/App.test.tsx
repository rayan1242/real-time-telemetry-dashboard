import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("./hooks/useTelemetry", () => ({
  useTelemetry: () => ({
    robots: {
      "robot-001": { deviceId: "robot-001", temperature: 25, battery: 90, timestamp: "2026-01-01T12:00:00Z" },
      "robot-002": { deviceId: "robot-002", temperature: 28, battery: 50, timestamp: "2026-01-01T11:59:00Z" }
    },
    connected: true,
    snapshotError: "",
    now: Date.parse("2026-01-01T12:00:05Z"),
    items: [
      { deviceId: "robot-001", temperature: 25, battery: 90, timestamp: "2026-01-01T12:00:00Z" },
      { deviceId: "robot-002", temperature: 28, battery: 50, timestamp: "2026-01-01T11:59:00Z" }
    ]
  })
}));

describe("fleet dashboard filtering", () => {
  it("filters robots by ID and status", () => {
    render(<App />);
    expect(screen.getByText("2 of 2 robots")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "robot-001" } });
    expect(screen.getByText("1 of 2 robots")).toBeTruthy();
    expect(screen.queryByText("robot-002")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Offline" }));
    expect(screen.getByText("1 of 2 robots")).toBeTruthy();
    expect(screen.getByText("robot-002")).toBeTruthy();
    expect(screen.queryByText("robot-001")).toBeNull();
  });
});
