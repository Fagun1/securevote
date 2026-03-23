import { Router } from "express";
import type { Pool } from "pg";
import type { Env } from "../config/env.js";
import { createAuthController } from "../controllers/authController.js";
import { requireAuth } from "../middleware/requireAuth.js";

export function authRoutes(env: Env, pool: Pool): Router {
  const r = Router();
  const c = createAuthController(env, pool);

  r.post("/auth/register", (req, res, next) => {
    Promise.resolve(c.register(req, res)).catch(next);
  });

  r.post("/auth/login", (req, res, next) => {
    Promise.resolve(c.login(req, res)).catch(next);
  });

  r.get("/auth/me", requireAuth(env), (req, res, next) => {
    Promise.resolve(c.me(req, res)).catch(next);
  });

  // Bootstrap the initial super_admin for empty databases.
  r.post("/super-admin/bootstrap", (req, res, next) => {
    Promise.resolve(c.superAdminBootstrap(req, res)).catch(next);
  });

  // Local-only convenience: promote the current account to super_admin
  // if no admin/super_admin exists yet. Useful when you started without
  // BOOTSTRAP_SUPER_ADMIN_TOKEN.
  r.post("/super-admin/promote", requireAuth(env), (req, res, next) => {
    Promise.resolve(c.promoteSelf(req, res)).catch(next);
  });

  return r;
}

