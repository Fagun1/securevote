import { Router } from "express";
import type { Pool } from "pg";
import type { Env } from "../config/env.js";
import { createVotingController } from "../controllers/votingController.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRoles } from "../middleware/requireRoles.js";

export function votingRoutes(env: Env, pool: Pool): Router {
  const r = Router();
  const c = createVotingController(env, pool);

  r.post(
    "/voting/cast",
    requireAuth(env),
    requireRoles(env, ["voter"]),
    (req, res, next) => {
      Promise.resolve(c.cast(req as any, res)).catch(next);
    }
  );

  return r;
}

