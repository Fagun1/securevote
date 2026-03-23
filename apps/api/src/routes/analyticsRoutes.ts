import { Router } from "express";
import type { Pool } from "pg";
import type { Env } from "../config/env.js";
import { createAnalyticsController } from "../controllers/analyticsController.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRoles } from "../middleware/requireRoles.js";

export function analyticsRoutes(env: Env, pool: Pool): Router {
  const r = Router();
  const c = createAnalyticsController(env, pool);

  r.get("/admin/analytics", requireAuth(env), requireRoles(env, ["admin", "super_admin"]), (req, res, next) => {
    Promise.resolve(c.analytics()).then((data) => res.json(data)).catch(next);
  });

  return r;
}

