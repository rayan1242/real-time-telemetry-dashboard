import { useEffect, useState } from "react";
import { alertsForRobot } from "./alerts";
import { useTelemetry } from "./hooks/useTelemetry";
import MetricChart from "./components/MetricChart";
import RobotCard from "./components/RobotCard";
import { API, HISTORY_LIMIT, isOnline, timeLabel, type Robot, type Metric, type StatusFilter } from "./telemetry";


export default function App() {
  const [enteredToken, setEnteredToken] = useState("");
  const [token, setToken] = useState("");
  const { robots, connected, snapshotError, now, items } = useTelemetry(token);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<Robot[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [metric, setMetric] = useState<Metric>("temperature");

  const selectedTimestamp = selected ? robots[selected]?.timestamp : undefined;
  useEffect(() => { setHistory([]); setHistoryError(""); }, [selected]);

  useEffect(() => {
    if (!selected || !token) return;
    let active = true;
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError("");
    const load = async () => {
      try {
        const response = await fetch(`${API}/api/robots/${encodeURIComponent(selected)}/history?limit=${HISTORY_LIMIT}`, { signal: controller.signal, headers: { authorization: `Bearer ${token}` } });
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
  }, [selected, selectedTimestamp, token]);

  const online = items.filter(robot => isOnline(robot, now)).length;
  const visible = items.filter(robot => robot.deviceId.toLowerCase().includes(search.trim().toLowerCase()) &&
    (status === "all" || (status === "online" ? isOnline(robot, now) : !isOnline(robot, now))));
  const current = selected ? robots[selected] : undefined;
  const last = history[history.length - 1];
  const alerts = items.flatMap(alertsForRobot);

  if (!token) return (
    <main className="login-page"><form className="login-panel" onSubmit={event => { event.preventDefault(); setToken(enteredToken.trim()); }}>
      <p className="eyebrow">SECURE FLEET MONITORING</p><h1>Operator access</h1>
      <p>Enter the dashboard access token configured on the API server.</p>
      <label htmlFor="dashboard-token">Dashboard token</label>
      <input id="dashboard-token" type="password" autoComplete="off" value={enteredToken} onChange={event => setEnteredToken(event.target.value)} required />
      <button type="submit" disabled={!enteredToken.trim()}>Open dashboard</button>
      <small>Demo access only. The token stays in memory and is cleared on refresh.</small>
    </form></main>
  );

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">OPERATIONS / FLEET MONITORING</p>
          <h1>Robot telemetry</h1>
          <p>Real-time robot health, sensor readings, and historical trends.</p>
        </div>
        <div className="header-actions"><button type="button" className="close-button" onClick={() => { setToken(""); setEnteredToken(""); setSelected(null); }}>Sign out</button><span className={connected ? "pill good" : "pill bad"} role="status">
          <span className="status-dot" /> {connected ? "Live connection" : "Reconnecting"}
        </span></div>
      </header>

      {snapshotError && <p className="notice" role="alert">Unable to refresh robot snapshot: {snapshotError}. Live updates may be incomplete.</p>}

      <section className="stats" aria-label="Fleet statistics">
        <div><small>Tracked robots</small><strong>{items.length}</strong><span>All reporting devices</span></div>
        <div><small>Online</small><strong className="good">{online}</strong><span>Seen in the last 10 seconds</span></div>
        <div><small>Offline</small><strong className={items.length - online ? "bad" : ""}>{items.length - online}</strong><span>Awaiting recent telemetry</span></div>
      </section>

      <section className="alert-section" aria-label="Active telemetry alerts">
        <div className="section-heading"><div><p className="eyebrow">HEALTH CHECKS</p><h2>Active alerts</h2></div><span className="count">{alerts.length} alerts</span></div>
        {alerts.length ? <div className="alert-list">{alerts.map(alert => <div className="alert-item" key={`${alert.deviceId}-${alert.kind}`} role="status"><strong>{alert.deviceId}</strong><span>{alert.message}</span></div>)}</div>
          : <p className="alert-clear">No temperature or battery threshold violations.</p>}
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
          {visible.map(robot => <RobotCard key={robot.deviceId} robot={robot} now={now} selected={selected === robot.deviceId} onSelect={setSelected} />)}
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

      <footer>Local demonstration · Operator token authentication is enabled, but tenant isolation, expiring sessions and production identity management are not implemented. Alerts are derived from the latest readings, not persisted.</footer>
    </main>
  );
}
