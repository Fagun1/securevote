import type { Pool } from "pg";
import type { Env } from "../config/env.js";
import { z } from "zod";
import { HttpError } from "../middleware/errorHandler.js";
import { getClientIp } from "../utils/ip.js";
import { createCandidate, deleteCandidate, listCandidates, updateCandidate } from "../services/candidateService.js";

const candidateCreateSchema = z.object({
  name: z.string().min(1).max(200),
  party: z.string().min(0).max(200).default(""),
});

const candidateUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  party: z.string().min(0).max(200).optional(),
});

export function createCandidateController(env: Env, pool: Pool) {
  async function list(_req: unknown, res: { json: (x: unknown) => unknown }) {
    const items = await listCandidates(pool);
    res.json({ candidates: items });
  }

  async function create(req: { auth?: { sub?: string }; body: unknown }, res: { json: (x: unknown) => unknown }) {
    const auth = req.auth;
    if (!auth?.sub) throw new HttpError(401, "Not authenticated");
    const ip = getClientIp(req as any);
    const body = candidateCreateSchema.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid request body");

    const created = await createCandidate(env, pool, body.data);
    await pool.query(
      `INSERT INTO logs (user_id, action, ip, metadata) VALUES ($1, $2, $3, $4::jsonb)`,
      [auth.sub, "candidate_create", ip || null, JSON.stringify({ candidateId: created.id })]
    );
    res.json({ candidate: created });
  }

  async function update(req: { auth?: { sub?: string }; params: any; body: unknown }, res: { json: (x: unknown) => unknown }) {
    const auth = req.auth;
    if (!auth?.sub) throw new HttpError(401, "Not authenticated");
    const ip = getClientIp(req as any);
    const body = candidateUpdateSchema.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid request body");

    const updated = await updateCandidate(env, pool, req.params.id, body.data);
    await pool.query(
      `INSERT INTO logs (user_id, action, ip, metadata) VALUES ($1, $2, $3, $4::jsonb)`,
      [auth.sub, "candidate_update", ip || null, JSON.stringify({ candidateId: updated.id })]
    );
    res.json({ candidate: updated });
  }

  async function remove(req: { auth?: { sub?: string }; params: any }, res: { json: (x: unknown) => unknown }) {
    const auth = req.auth;
    if (!auth?.sub) throw new HttpError(401, "Not authenticated");
    const ip = getClientIp(req as any);

    const removed = await deleteCandidate(env, pool, req.params.id);
    await pool.query(
      `INSERT INTO logs (user_id, action, ip, metadata) VALUES ($1, $2, $3, $4::jsonb)`,
      [auth.sub, "candidate_delete", ip || null, JSON.stringify({ candidateId: req.params.id })]
    );
    res.json(removed);
  }

  return { list, create, update, remove };
}

