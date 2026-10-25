import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTelemetry } from "./useTelemetry";

type Listener = (...args: unknown[]) => void;
const socketMock = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  return {
    listeners,
    socket: {
      connected: false,
      on: vi.fn((name: string, listener: (...args: any[]) => void) => {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)!.add(listener);
      }),
      off: vi.fn((name: string, listener: (...args: any[]) => void) => {
        listeners.get(name)?.delete(listener);
      }),
      emit: vi.fn(),
      disconnect: vi.fn()
    }
  };
});
vi.mock("socket.io-client", () => ({ io: vi.fn(() => socketMock.socket) }));

function emit(name: string, ...args: unknown[]) {
  for (const listener of socketMock.listeners.get(name) ?? []) (listener as Listener)(...args);
}

const first = {
  deviceId: "robot-001",
  temperature: 24,
  battery: 90,
  timestamp: "2026-01-01T12:00:00Z"
};
const newer = { ...first, temperature: 30, timestamp: "2026-01-01T12:00:05Z" };

describe("useTelemetry", () => {
  beforeEach(() => {
    socketMock.listeners.clear();
    socketMock.socket.connected = false;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [first] })
    }));
  });

  it("loads an initial REST snapshot and subscribes when connected", async () => {
    const { result, unmount } = renderHook(() => useTelemetry("demo-token"));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => {
      socketMock.socket.connected = true;
      emit("connect");
    });
    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(socketMock.socket.emit).toHaveBeenCalledWith("watch", expect.arrayContaining(["robot-001"]));
    unmount();
    expect(socketMock.socket.disconnect).toHaveBeenCalled();
  });

  it("accepts live events and rejects older updates", async () => {
    const { result, unmount } = renderHook(() => useTelemetry("demo-token"));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => {
      emit("telemetry", newer);
      emit("telemetry", { ...first, temperature: 18 });
    });
    expect(result.current.robots["robot-001"].temperature).toBe(30);
    unmount();
  });

  it("fetches a fresh snapshot after reconnection", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [first] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [newer] }) });
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = renderHook(() => useTelemetry("demo-token"));
    await waitFor(() => expect(result.current.robots["robot-001"]?.temperature).toBe(24));
    act(() => emit("disconnect"));
    act(() => {
      socketMock.socket.connected = true;
      emit("connect");
    });
    await waitFor(() => expect(result.current.robots["robot-001"]?.temperature).toBe(30));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unmount();
  });
});
