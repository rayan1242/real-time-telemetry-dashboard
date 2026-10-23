import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

type Robot = { deviceId: string; temperature: number; battery: number; timestamp: string };
const API = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const offlineAfterMs = 10_000;

function merge(current: Record<string, Robot>, next: Robot): Record<string, Robot> {
  const previous = current[next.deviceId];
  if (previous && Date.parse(previous.timestamp) > Date.parse(next.timestamp)) return current;
  return { ...current, [next.deviceId]: next };
}

export default function App() {
  const [robots, setRobots] = useState<Record<string, Robot>>({});
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<Robot[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch(`${API}/api/robots`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: { items: Robot[] } = await response.json();
        if (active) setRobots(previous => data.items.reduce(merge, previous));
      } catch (error) { console.error("Snapshot failed", error); }
    }
    const socket = io(API, { transports: ["websocket"], reconnectionDelayMax: 10000 });
    socket.on("connect", () => {
      setConnected(true);
      // Subscribe to all demo robot IDs. Real deployments should use authorized subscriptions.
      socket.emit("watch", Array.from({ length: 12 }, (_, i) => `robot-${String(i + 1).padStart(3, "0")}`));
      void refresh();
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("telemetry", (event: Robot) => setRobots(previous => merge(previous, event)));
    void refresh();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { active = false; socket.disconnect(); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    fetch(`${API}/api/robots/${encodeURIComponent(selected)}/history?limit=40`)
      .then(response => response.json())
      .then((data: { items: Robot[] }) => { if (active) setHistory(data.items); })
      .catch(console.error);
    return () => { active = false; };
  }, [selected, robots[selected ?? ""]?.timestamp]);

  const items = useMemo(() => Object.values(robots).sort((a, b) => a.deviceId.localeCompare(b.deviceId)), [robots]);
  const online = items.filter(robot => now - Date.parse(robot.timestamp) < offlineAfterMs).length;
  return (
    <main>
      <header><div><p className="eyebrow">OPERATIONS / LIVE</p><h1>Robot telemetry</h1><p>Live sensor monitoring · PostgreSQL + Redis + Socket.IO</p></div><span className={connected ? "pill good" : "pill bad"}>{connected ? "● Live connection" : "● Reconnecting"}</span></header>
      <section className="stats"><div><small>Tracked robots</small><strong>{items.length}</strong></div><div><small>Online</small><strong>{online}</strong></div><div><small>Offline</small><strong>{items.length - online}</strong></div></section>
      <h2>Fleet overview</h2>
      <div className="grid">{items.length ? items.map(robot => {
        const live = now - Date.parse(robot.timestamp) < offlineAfterMs;
        return <button key={robot.deviceId} className={"robot " + (selected === robot.deviceId ? "selected" : "")} onClick={() => setSelected(robot.deviceId)}>
          <div className="robot-title"><b>{robot.deviceId}</b><span className={live ? "online" : "offline"}>{live ? "Online" : "Offline"}</span></div>
          <div className="readings"><div><small>Temperature</small><strong>{robot.temperature.toFixed(1)}°C</strong></div><div><small>Battery</small><strong>{robot.battery}%</strong></div></div>
          <small>Last seen: {new Date(robot.timestamp).toLocaleTimeString()}</small>
        </button>;
      }) : <p>No telemetry yet. Start the simulator to see live robots.</p>}</div>
      {selected && <section className="detail"><div className="robot-title"><h2>{selected} · recent temperature</h2><button onClick={() => setSelected(null)}>Close</button></div>
        <div className="bars">{history.map((point, i) => <div key={i} title={`${point.temperature}°C at ${new Date(point.timestamp).toLocaleTimeString()}`} style={{ height: `${Math.max(5, Math.min(100, point.temperature * 2))}%` }} />)}</div>
        <small>Last {history.length} readings · newest on the right</small>
      </section>}
      <footer>Local demonstration only. Authentication and tenant isolation are not yet implemented.</footer>
    </main>
  );
}
