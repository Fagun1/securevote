import { Router } from "express";
import type { Pool } from "pg";
import type { Env } from "../config/env.js";
import { createBlockchainController } from "../controllers/blockchainController.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRoles } from "../middleware/requireRoles.js";

export function blockchainRoutes(env: Env, pool: Pool): Router {
  const r = Router();
  const c = createBlockchainController(env, pool);

  r.post(
    "/admin/blockchain/validate",
    requireAuth(env),
    requireRoles(env, ["super_admin"]),
    (req, res, next) => {
      Promise.resolve(c.validate()).then((data) => res.json(data)).catch(next);
    }
  );

  return r;
}

