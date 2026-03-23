import type { NextFunction, Response } from "express";
import { HttpError } from "./errorHandler.js";
import type { Env } from "../config/env.js";
import type { AuthedRequest } from "./requireAuth.js";

export function requireRoles(
  _env: Env,
  allowed: Array<NonNullable<AuthedRequest["auth"]>["role"]>
) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(new HttpError(401, "Not authenticated"));
    if (!allowed.includes(req.auth.role)) {
      return next(new HttpError(403, "Forbidden"));
    }
    return next();
  };
}

