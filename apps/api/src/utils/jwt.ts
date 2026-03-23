import jwt from "jsonwebtoken";
import type { Env } from "../config/env.js";

export type JwtClaims = {
  sub: string; // user id
  role: "voter" | "admin" | "super_admin";
};

export function createJwt(env: Env, claims: JwtClaims): string {
  // `jsonwebtoken` typings are strict about `expiresIn` shape; cast because env supplies runtime values like "1h".
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as any });
}

export function verifyJwt(env: Env, token: string): JwtClaims {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === "string" || decoded === null || typeof decoded !== "object") {
    throw new Error("Invalid JWT");
  }
  const c = decoded as Record<string, unknown>;
  const sub = c.sub;
  const role = c.role;
  if (typeof sub !== "string" || typeof role !== "string") {
    throw new Error("Invalid JWT claims");
  }
  if (!["voter", "admin", "super_admin"].includes(role)) {
    throw new Error("Invalid JWT role");
  }
  return { sub, role: role as JwtClaims["role"] };
}

