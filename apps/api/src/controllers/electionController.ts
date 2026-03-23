import type { Pool } from "pg";
import type { Env } from "../config/env.js";
import { HttpError } from "../middleware/errorHandler.js";
import { getClientIp } from "../utils/ip.js";
import { startElection, endElection, getActiveElection } from "../services/electionService.js";
import { z } from "zod";
import { createAnalyticsController } from "./analyticsController.js";

const startSchema = z.object({
  end_time: z.string().min(1),
  start_time: z.string().min(1).optional(),
});

export function createElectionController(env: Env, pool: Pool) {
  async function start(req: { auth?: { sub?: string; role?: string }; body: unknown; ip?: string }, res: { json: (x: unknown) => unknown }) {
    const auth = req.auth;
    if (!auth?.sub) throw new HttpError(401, "Not authenticated");
    const body = startSchema.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid request body");

    const ip = getClientIp(req as any);
    const election = await startElection(env, pool, {
      endTime: body.data.end_time,
      startTime: body.data.start_time,
    });

    await pool.query(
      `INSERT INTO logs (user_id, action, ip, metadata) VALUES ($1, $2, $3, $4::jsonb)`,
      [auth.sub, "election_start", ip || null, JSON.stringify({ electionId: election.id, end_time: election.end_time })]
    );

    const io = (req as any).app?.get?.("io");
    if (io?.to) {
      const snapshot = await createAnalyticsController(env, pool).analytics();
      io.to("admins").emit("dashboard:updated", snapshot);
    }
    res.json({ election });
  }

  async function stop(req: { auth?: { sub?: string }; body?: unknown; ip?: string }, res: { json: (x: unknown) => unknown }) {
    const auth = req.auth;
    if (!auth?.sub) throw new HttpError(401, "Not authenticated");

    const ip = getClientIp(req as any);
    const election = await endElection(env, pool);

    await pool.query(
      `INSERT INTO logs (user_id, action, ip, metadata) VALUES ($1, $2, $3, $4::jsonb)`,
      [auth.sub, "election_end", ip || null, JSON.stringify({ electionId: election.id })]
    );

    const io = (req as any).app?.get?.("io");
    if (io?.to) {
      const snapshot = await createAnalyticsController(env, pool).analytics();
      io.to("admins").emit("dashboard:updated", snapshot);
    }

    res.json({ election });
  }

  async function active(req: unknown, res: { json: (x: unknown) => unknown }) {
    const election = await getActiveElection(pool);
    res.json({ election });
  }

  return { start, stop, active };
}

