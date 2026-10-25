import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export function secureEqual(value: unknown, expected: string | undefined): boolean {
  if (typeof value !== "string" || !expected) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function dashboardAuthorized(token: unknown): boolean {
  return secureEqual(token, process.env.DASHBOARD_TOKEN);
}

export function requireDashboard(req: Request, res: Response, next: NextFunction) {
  const authorization = req.header("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!dashboardAuthorized(token)) {
    res.status(401).json({ error: "Dashboard authorization required" });
    return;
  }
  next();
}

/** Optional per-device keys; if configured, a key is bound to its deviceId. */
export function validDeviceKey(provided: unknown, deviceId: string): boolean {
  const configured = process.env.DEVICE_API_KEYS;
  if (configured) {
    let keys: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(configured);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
      keys = parsed as Record<string, unknown>;
    } catch { return false; }
    const expected = keys[deviceId];
    return typeof expected === "string" && secureEqual(provided, expected);
  }
  return secureEqual(provided, process.env.INGEST_API_KEY);
}
