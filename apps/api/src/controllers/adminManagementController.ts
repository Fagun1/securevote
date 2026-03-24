import { z } from "zod";
import type { Pool } from "pg";
import type { Env } from "../config/env.js";
import { HttpError } from "../middleware/errorHandler.js";
import { getClientIp } from "../utils/ip.js";
import { createAdminAccount, createVoterAccount, setVoterFaceEncoding } from "../services/userManagementService.js";

const createAdminSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  faceImageBase64: z.string().min(10),
});

const createVoterSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  faceImageBase64: z.string().min(10).optional(),
});

const enrollFaceSchema = z.object({
  faceImageBase64: z.string().min(10),
});

export function createAdminManagementController(env: Env, pool: Pool) {
  async function createAdmin(
    req: { auth?: { sub?: string; role?: string }; body: unknown; headers: unknown; ip?: string },
    res: { json: (x: unknown) => unknown }
  ) {
    const auth = req.auth;
    if (!auth?.sub || !auth.role) throw new HttpError(401, "Not authenticated");
    const body = createAdminSchema.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid request body", body.error.flatten().fieldErrors);

    const result = await createAdminAccount({
      env,
      pool,
      actor: { userId: auth.sub, role: auth.role as "voter" | "admin" | "super_admin", ip: getClientIp(req as any) },
      name: body.data.name,
      email: body.data.email,
      faceImageBase64: body.data.faceImageBase64,
    });
    res.json({ ok: true, user: { id: result.id, email: result.email, role: result.role } });
  }

  async function createVoter(
    req: { auth?: { sub?: string; role?: string }; body: unknown; headers: unknown; ip?: string },
    res: { json: (x: unknown) => unknown }
  ) {
    const auth = req.auth;
    if (!auth?.sub || !auth.role) throw new HttpError(401, "Not authenticated");
    const body = createVoterSchema.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid request body", body.error.flatten().fieldErrors);

    const result = await createVoterAccount({
      env,
      pool,
      actor: { userId: auth.sub, role: auth.role as "voter" | "admin" | "super_admin", ip: getClientIp(req as any) },
      name: body.data.name,
      email: body.data.email,
      faceImageBase64: body.data.faceImageBase64,
    });
    res.json({ ok: true, user: { id: result.id, email: result.email, role: result.role } });
  }

  async function enrollVoterFace(
    req: { auth?: { sub?: string; role?: string }; body: unknown; params: { id: string }; headers: unknown; ip?: string },
    res: { json: (x: unknown) => unknown }
  ) {
    const auth = req.auth;
    if (!auth?.sub || !auth.role) throw new HttpError(401, "Not authenticated");
    const body = enrollFaceSchema.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid request body", body.error.flatten().fieldErrors);

    const result = await setVoterFaceEncoding({
      env,
      pool,
      actor: { userId: auth.sub, role: auth.role as "voter" | "admin" | "super_admin", ip: getClientIp(req as any) },
      voterId: req.params.id,
      faceImageBase64: body.data.faceImageBase64,
    });
    res.json(result);
  }

  return { createAdmin, createVoter, enrollVoterFace };
}
