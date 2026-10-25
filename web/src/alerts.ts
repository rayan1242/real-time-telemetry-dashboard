import type { Robot } from "./telemetry";

export const HIGH_TEMPERATURE_C = 35;
export const LOW_BATTERY_PERCENT = 20;

export type RobotAlert = { deviceId: string; kind: "temperature" | "battery"; message: string };

export function alertsForRobot(robot: Robot): RobotAlert[] {
  const alerts: RobotAlert[] = [];
  if (robot.temperature >= HIGH_TEMPERATURE_C)
    alerts.push({ deviceId: robot.deviceId, kind: "temperature", message: `High temperature: ${robot.temperature.toFixed(1)}°C` });
  if (robot.battery <= LOW_BATTERY_PERCENT)
    alerts.push({ deviceId: robot.deviceId, kind: "battery", message: `Low battery: ${robot.battery.toFixed(0)}%` });
  return alerts;
}
