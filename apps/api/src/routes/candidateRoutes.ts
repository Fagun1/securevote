import { Router } from "express";
import type { Pool } from "pg";
import type { Env } from "../config/env.js";
import { createCandidateController } from "../controllers/candidateController.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRoles } from "../middleware/requireRoles.js";

export function candidateRoutes(env: Env, pool: Pool): Router {
  const r = Router();
  const c = createCandidateController(env, pool);

  r.get("/public/candidates", (req, res, next) => {
    Promise.resolve(c.list(req, res)).catch(next);
  });

  const adminMiddleware = [requireAuth(env), requireRoles(env, ["admin", "super_admin"])];

  r.post("/admin/candidates", ...adminMiddleware, (req, res, next) => {
    Promise.resolve(c.create(req as any, res)).catch(next);
  });
  r.patch("/admin/candidates/:id", ...adminMiddleware, (req, res, next) => {
    Promise.resolve(c.update({ ...(req as any), params: req.params }, res)).catch(next);
  });
  r.delete("/admin/candidates/:id", ...adminMiddleware, (req, res, next) => {
    Promise.resolve(c.remove({ ...(req as any), params: req.params }, res)).catch(next);
  });

  return r;
}

