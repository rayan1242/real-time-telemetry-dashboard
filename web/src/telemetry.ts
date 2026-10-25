export type Robot = {
  deviceId: string;
  temperature: number;
  battery: number;
  timestamp: string;
  eventId?: string;
};
export type StatusFilter = "all" | "online" | "offline";
export type Metric = "temperature" | "battery";
export const API = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
export const HISTORY_LIMIT = 80;
export function merge(current: Record<string, Robot>, next: Robot): Record<string, Robot> {
  const previous = current[next.deviceId];
  if (previous && Date.parse(previous.timestamp) > Date.parse(next.timestamp)) return current;
  return { ...current, [next.deviceId]: next };
}
export function isOnline(robot: Robot, now: number) {
  return now - Date.parse(robot.timestamp) < 10_000;
}
export function timeLabel(value: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? "Unknown" : time.toLocaleTimeString();
}
