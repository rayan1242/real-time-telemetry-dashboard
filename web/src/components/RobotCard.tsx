import type { Robot } from "../telemetry";
import { isOnline, timeLabel } from "../telemetry";

export default function RobotCard({ robot, now, selected, onSelect }: {
  robot: Robot;
  now: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const live = isOnline(robot, now);
  return (
    <button type="button" className={`robot ${selected ? "selected" : ""}`} onClick={() => onSelect(robot.deviceId)} aria-pressed={selected}>
      <div className="robot-title"><b>{robot.deviceId}</b><span className={live ? "online" : "offline"}><span className="status-dot" /> {live ? "Online" : "Offline"}</span></div>
      <div className="readings"><div><small>Temperature</small><strong>{robot.temperature.toFixed(1)}°C</strong></div><div><small>Battery</small><strong>{robot.battery.toFixed(0)}%</strong></div></div>
      <div className="battery-track" aria-hidden="true"><div style={{ width: `${Math.max(0, Math.min(100, robot.battery))}%` }} /></div>
      <small>Last seen {timeLabel(robot.timestamp)}</small>
    </button>
  );
}
