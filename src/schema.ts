import { z } from "zod";

export const telemetrySchema = z.object({
  eventId: z.string().uuid(),
  deviceId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  temperature: z.number().finite().min(-100).max(300),
  battery: z.number().finite().min(0).max(100),
  timestamp: z.string().datetime({ offset: true }).optional(),
});

export type TelemetryInput = z.infer<typeof telemetrySchema>;
export type TelemetryEvent = Omit<TelemetryInput, "timestamp"> & { timestamp: string };
export function normalizeTelemetry(input: TelemetryInput): TelemetryEvent {
  return { ...input, timestamp: input.timestamp ?? new Date().toISOString() };
}
