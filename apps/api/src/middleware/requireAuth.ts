import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./errorHandler.js";
import type { Env } from "../config/env.js";
import { verifyJwt, type JwtClaims } from "../utils/jwt.js";

export type AuthedRequest = Request & { auth?: JwtClaims };

export function requireAuth(env: Env) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (typeof header !== "string") {
      return next(new HttpError(401, "Missing Authorization header"));
    }

    const m = header.match(/^Bearer\s+(.+)$/i);
    if (!m) {
      return next(new HttpError(401, "Invalid Authorization header"));
    }

    try {
      const claims = verifyJwt(env, m[1]);
      req.auth = claims;
      return next();
    } catch {
      return next(new HttpError(401, "Invalid token"));
    }
  };
}

