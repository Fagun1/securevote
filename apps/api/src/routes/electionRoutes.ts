import { Router } from "express";
import type { Pool } from "pg";
import type { Env } from "../config/env.js";
import { createElectionController } from "../controllers/electionController.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRoles } from "../middleware/requireRoles.js";

export function electionRoutes(env: Env, pool: Pool): Router {
  const r = Router();
  const c = createElectionController(env, pool);

  // Public: active election for voters.
  r.get("/public/election/active", (req, res, next) => {
    Promise.resolve(c.active(req, res)).catch(next);
  });

  const adminMiddleware = [requireAuth(env), requireRoles(env, ["admin", "super_admin"])];

  r.post("/admin/election/start", ...adminMiddleware, (req, res, next) => {
    Promise.resolve(c.start(req as any, res)).catch(next);
  });

  r.post("/admin/election/end", ...adminMiddleware, (req, res, next) => {
    Promise.resolve(c.stop(req as any, res)).catch(next);
  });

  return r;
}

