import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { API, merge, type Robot } from "../telemetry";

/** Owns the live transport, fleet snapshot and reconnect synchronization. */
export function useTelemetry(token: string) {
  const [robots, setRobots] = useState<Record<string, Robot>>({});
  const [connected, setConnected] = useState(false);
  const [snapshotError, setSnapshotError] = useState("");
  const [now, setNow] = useState(Date.now());
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) { setRobots({}); setConnected(false); setSnapshotError(""); return; }
    let active = true;
    async function refresh() {
      try {
        const response = await fetch(`${API}/api/robots`, { headers: { authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: { items: Robot[] } = await response.json();
        if (!active) return;
        setRobots(previous => data.items.reduce(merge, previous));
        setSnapshotError("");
      } catch (error) {
        if (active) setSnapshotError(error instanceof Error ? error.message : "Snapshot unavailable");
      }
    }
    const socket = io(API, { transports: ["websocket"], auth: { token }, reconnectionDelayMax: 10_000 });
    socketRef.current = socket;
    socket.on("connect", () => {
      if (!active) return;
      setConnected(true);
      // Pub/Sub notifications are ephemeral; restore the latest state over REST.
      void refresh();
    });
    socket.on("disconnect", () => { if (active) setConnected(false); });
    socket.on("telemetry", (event: Robot) => {
      if (active) setRobots(previous => merge(previous, event));
    });
    void refresh();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      socket.disconnect();
      socketRef.current = null;
      window.clearInterval(timer);
    };
  }, [token]);

  const items = useMemo(() => Object.values(robots).sort((a, b) => a.deviceId.localeCompare(b.deviceId)), [robots]);
  const deviceIds = useMemo(
    () => Array.from(new Set([...Array.from({ length: 12 }, (_, i) => `robot-${String(i + 1).padStart(3, "0")}`), ...items.map(robot => robot.deviceId)])).slice(0, 100),
    [items]
  );
  const deviceKey = deviceIds.join("|");

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const subscribe = () => socket.emit("watch", deviceIds);
    socket.on("connect", subscribe);
    if (socket.connected) subscribe();
    return () => { socket.off("connect", subscribe); };
  }, [deviceKey, token]);

  return { robots, connected, snapshotError, now, items };
}
