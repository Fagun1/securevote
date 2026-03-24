import { Router } from "express";
import type { Pool } from "pg";
import type { Env } from "../config/env.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRoles } from "../middleware/requireRoles.js";
import { createAdminManagementController } from "../controllers/adminManagementController.js";

export function adminManagementRoutes(env: Env, pool: Pool): Router {
  const r = Router();
  const c = createAdminManagementController(env, pool);

  r.post("/admin/create", requireAuth(env), requireRoles(env, ["super_admin"]), (req, res, next) => {
    Promise.resolve(c.createAdmin(req as any, res)).catch(next);
  });

  r.post("/admin/voters/create", requireAuth(env), requireRoles(env, ["admin", "super_admin"]), (req, res, next) => {
    Promise.resolve(c.createVoter(req as any, res)).catch(next);
  });

  r.post(
    "/admin/voters/:id/face",
    requireAuth(env),
    requireRoles(env, ["admin", "super_admin"]),
    (req, res, next) => {
      Promise.resolve(c.enrollVoterFace({ ...(req as any), params: req.params }, res)).catch(next);
    }
  );

  return r;
}
