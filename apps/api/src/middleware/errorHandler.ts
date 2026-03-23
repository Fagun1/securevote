import type { NextFunction, Request, Response } from "express";

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      error: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  // Support errors thrown from services using a lightweight convention:
  // `throw Object.assign(new Error("..."), { statusCode: 409 })`
  const maybe = err as { statusCode?: unknown; message?: unknown };
  if (typeof maybe?.statusCode === "number" && typeof maybe?.message === "string") {
    res.status(maybe.statusCode).json({ error: maybe.message });
    return;
  }

  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}
