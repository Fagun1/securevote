import { Router } from "express";
import type { Pool } from "pg";
import type { Env } from "../config/env.js";
import { createAuthController } from "../controllers/authController.js";
import { requireAuth } from "../middleware/requireAuth.js";

export function authRoutes(env: Env, pool: Pool): Router {
  const r = Router();
  const c = createAuthController(env, pool);

  r.post("/auth/login", (req, res, next) => {
    Promise.resolve(c.login(req, res)).catch(next);
  });

  r.get("/auth/me", requireAuth(env), (req, res, next) => {
    Promise.resolve(c.me(req, res)).catch(next);
  });

  return r;
}

