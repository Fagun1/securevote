import type { Request } from "express";

export function getClientIp(req: Request): string {
  // If trust proxy is enabled, req.ip respects X-Forwarded-For.
  // Still, handle common multi-proxy header format safely.
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  if (Array.isArray(xff) && xff.length > 0) return xff[0]!;
  return typeof req.ip === "string" ? req.ip : "0.0.0.0";
}

