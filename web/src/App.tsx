import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

type Robot = {
  deviceId: string;
  temperature: number;
  battery: number;
  timestamp: string;
  eventId?: string;
};
type StatusFilter = "all" | "online" | "offline";
type Metric = "temperature" | "battery";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const OFFLINE_AFTER_MS = 10_000;
const HISTORY_LIMIT = 80;

function merge(current: Record<string, Robot>, next: Robot): Record<string, Robot> {
  const previous = current[next.deviceId];
  if (previous && Date.parse(previous.timestamp) > Date.parse(next.timestamp)) return current;
  return { ...current, [next.deviceId]: next };
}

function isOnline(robot: Robot, now: number) {
  return now - Date.parse(robot.timestamp) < OFFLINE_AFTER_MS;
}

function timeLabel(value: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? "Unknown" : time.toLocaleTimeString();
}

function MetricChart({ points, metric }: { points: Robot[]; metric: Metric }) {
  const values = points.map(point => point[metric]);
  if (!values.length) return <div className="chart-empty">No historical readings yet.</div>;

  const width = 720;
  const height = 220;
  const left = 44;
  const right = 14;
  const top = 18;
  const bottom = 32;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const minimum = metric === "battery" ? 0 : Math.floor(Math.min(...values) - 2);
  const maximum = metric === "battery" ? 100 : Math.ceil(Math.max(...values) + 2);
  const span = Math.max(1, maximum - minimum);
  const x = (index: number) => left + (values.length === 1 ? plotWidth / 2 : index * plotWidth / (values.length - 1));
  const y = (value: number) => top + (maximum - value) / span * plotHeight;
  const coordinates = values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  const fillPath = `M ${x(0)} ${y(values[0])} ${values.slice(1).map((value, index) => `L ${x(index + 1)} ${y(value)}`).join(" ")} L ${x(values.length - 1)} ${top + plotHeight} L ${x(0)} ${top + plotHeight} Z`;
  const ticks = [0, 0.5, 1];

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metric} over the last ${points.length} readings`}>
        <defs>
          <linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={metric === "temperature" ? "#60e0c1" : "#81a9ff"} stopOpacity=".3" />
            <stop offset="100%" stopColor={metric === "temperature" ? "#60e0c1" : "#81a9ff"} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map(tick => {
          const value = minimum + tick * span;
          const position = y(value);
          return <g key={tick}>
            <line x1={left} x2={width - right} y1={position} y2={position} stroke="#30435a" strokeDasharray="4 5" />
            <text x={left - 9} y={position + 4} fill="#a6b6ce" textAnchor="end" fontSize="12">{value.toFixed(0)}</text>
          </g>;
        })}
        <path d={fillPath} fill={`url(#fill-${metric})`} />
        <polyline points={coordinates} fill="none" stroke={metric === "temperature" ? "#60e0c1" : "#81a9ff"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="4" fill={metric === "temperature" ? "#60e0c1" : "#81a9ff"} />
        <text x={left} y={height - 7} fill="#a6b6ce" fontSize="12">{timeLabel(points[0].timestamp)}</text>
        <text x={width - right} y={height - 7} fill="#a6b6ce" fontSize="12" textAnchor="end">{timeLabel(points[points.length - 1].timestamp)}</text>
      </svg>
    </div>
  );
}

export default function App() {
  const [robots, setRobots] = useState<Record<string, Robot>>({});
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<Robot[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [snapshotError, setSnapshotError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [metric, setMetric] = useState<Metric>("temperature");
  const [now, setNow] = useState(Date.now());
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch(`${API}/api/robots`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: { items: Robot[] } = await response.json();
        if (!active) return;
        setRobots(previous => data.items.reduce(merge, previous));
        setSnapshotError("");
      } catch (error) {
        if (active) setSnapshotError(error instanceof Error ? error.message : "Snapshot unavailable");
      }
    }

    const socket = io(API, { transports: ["websocket"], reconnectionDelayMax: 10_000 });
    socketRef.current = socket;
    socket.on("connect", () => {
      if (!active) return;
      setConnected(true);
      // Re-fetch after reconnect: Socket.IO notifications are not durable.
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
  }, []);

  const items = useMemo(() => Object.values(robots).sort((a, b) => a.deviceId.localeCompare(b.deviceId)), [robots]);
  const deviceIds = useMemo(() => items.map(robot => robot.deviceId), [items]);
  const deviceKey = deviceIds.join("|");

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const subscribe = () => {
      // The server limits subscriptions to 100 rooms per socket.
      socket.emit("watch", deviceIds.slice(0, 100));
    };
    socket.on("connect", subscribe);
    if (socket.connected) subscribe();
    return () => { socket.off("connect", subscribe); };
  }, [deviceKey]);

  const selectedTimestamp = selected ? robots[selected]?.timestamp : undefined;
  useEffect(() => {
    if (!selected) { setHistory([]); setHistoryError(""); return; }
    let active = true;
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistory([]);
    setHistoryError("");
    const load = async () => {
      try {
        const response = await fetch(`${API}/api/robots/${encodeURIComponent(selected)}/history?limit=${HISTORY_LIMIT}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: { items: Robot[] } = await response.json();
        if (active) { setHistory(data.items); setHistoryError(""); }
      } catch (error) {
        if (active && !controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : "History unavailable");
      } finally {
        if (active) setHistoryLoading(false);
      }
    };
    void load();
    return () => { active = false; controller.abort(); };
  }, [selected, selectedTimestamp]);

  const online = items.filter(robot => isOnline(robot, now)).length;
  const visible = items.filter(robot => robot.deviceId.toLowerCase().includes(search.trim().toLowerCase()) &&
    (status === "all" || (status === "online" ? isOnline(robot, now) : !isOnline(robot, now))));
  const current = selected ? robots[selected] : undefined;
  const last = history[history.length - 1];

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">OPERATIONS / FLEET MONITORING</p>
          <h1>Robot telemetry</h1>
          <p>Real-time robot health, sensor readings, and historical trends.</p>
        </div>
        <span className={connected ? "pill good" : "pill bad"} role="status">
          <span className="status-dot" /> {connected ? "Live connection" : "Reconnecting"}
        </span>
      </header>

      {snapshotError && <p className="notice" role="alert">Unable to refresh robot snapshot: {snapshotError}. Live updates may be incomplete.</p>}

      <section className="stats" aria-label="Fleet statistics">
        <div><small>Tracked robots</small><strong>{items.length}</strong><span>All reporting devices</span></div>
        <div><small>Online</small><strong className="good">{online}</strong><span>Seen in the last 10 seconds</span></div>
        <div><small>Offline</small><strong className={items.length - online ? "bad" : ""}>{items.length - online}</strong><span>Awaiting recent telemetry</span></div>
      </section>

      <section className="fleet-section">
        <div className="section-heading"><div><p className="eyebrow">FLEET</p><h2>Robot overview</h2></div><span className="count">{visible.length} of {items.length} robots</span></div>
        <div className="toolbar">
          <label className="search-label" htmlFor="robot-search">Search robots
            <input id="robot-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by robot ID..." />
          </label>
          <div className="filter-buttons" role="group" aria-label="Filter by status">
            {(["all", "online", "offline"] as const).map(filter =>
              <button key={filter} type="button" className={status === filter ? "active" : ""} aria-pressed={status === filter} onClick={() => setStatus(filter)}>{filter[0].toUpperCase() + filter.slice(1)}</button>
            )}
          </div>
        </div>
        <div className="grid">
          {visible.map(robot => {
            const live = isOnline(robot, now);
            return <button type="button" key={robot.deviceId} className={`robot ${selected === robot.deviceId ? "selected" : ""}`} onClick={() => setSelected(robot.deviceId)} aria-pressed={selected === robot.deviceId}>
              <div className="robot-title"><b>{robot.deviceId}</b><span className={live ? "online" : "offline"}><span className="status-dot" /> {live ? "Online" : "Offline"}</span></div>
              <div className="readings"><div><small>Temperature</small><strong>{robot.temperature.toFixed(1)}°C</strong></div><div><small>Battery</small><strong>{robot.battery.toFixed(0)}%</strong></div></div>
              <div className="battery-track" aria-hidden="true"><div style={{ width: `${Math.max(0, Math.min(100, robot.battery))}%` }} /></div>
              <small>Last seen {timeLabel(robot.timestamp)}</small>
            </button>;
          })}
          {!items.length && <div className="empty-state">No telemetry yet. Start the simulator to see live robots.</div>}
          {!!items.length && !visible.length && <div className="empty-state">No robots match your filters.</div>}
        </div>
      </section>

      {selected && <section className="detail" aria-label="Selected robot details">
        <div className="detail-header">
          <div><p className="eyebrow">ROBOT DETAILS</p><h2>{selected}</h2><p>Historical sensor readings from PostgreSQL</p></div>
          <button type="button" className="close-button" onClick={() => setSelected(null)}>Close ×</button>
        </div>
        {current && <div className="detail-summary"><span>Temperature <strong>{current.temperature.toFixed(1)}°C</strong></span><span>Battery <strong>{current.battery.toFixed(0)}%</strong></span><span>Last seen <strong>{timeLabel(current.timestamp)}</strong></span></div>}
        <div className="chart-heading"><div><h3>{metric === "temperature" ? "Temperature trend" : "Battery trend"}</h3><small>{history.length} readings · chronological order</small></div>
          <div className="filter-buttons" role="group" aria-label="Chart metric">
            <button type="button" className={metric === "temperature" ? "active" : ""} aria-pressed={metric === "temperature"} onClick={() => setMetric("temperature")}>Temperature</button>
            <button type="button" className={metric === "battery" ? "active" : ""} aria-pressed={metric === "battery"} onClick={() => setMetric("battery")}>Battery</button>
          </div>
        </div>
        {historyError && <p className="notice" role="alert">Could not load history: {historyError}</p>}
        {historyLoading && !history.length ? <div className="chart-empty">Loading historical readings...</div> : <MetricChart points={history} metric={metric} />}
        {last && <p className="chart-footnote">Latest chart reading: {last[metric].toFixed(1)}{metric === "temperature" ? "°C" : "%"} at {timeLabel(last.timestamp)}</p>}
      </section>}

      <footer>Local demonstration · WebSocket updates are best-effort; REST snapshots restore state after reconnecting. Authentication and tenant isolation are not yet implemented.</footer>
    </main>
  );
}
