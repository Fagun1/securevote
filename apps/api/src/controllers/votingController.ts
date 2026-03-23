import type { Pool } from "pg";
import type { Env } from "../config/env.js";
import { HttpError } from "../middleware/errorHandler.js";
import { getClientIp } from "../utils/ip.js";
import { castVote } from "../services/votingService.js";
import { z } from "zod";
import { createAnalyticsController } from "./analyticsController.js";

const castSchema = z.object({
  candidateId: z.string().min(1),
});

export function createVotingController(env: Env, pool: Pool) {
  async function cast(req: { auth?: { sub?: string; role?: string }; body: unknown; headers: unknown; ip?: string }, res: { json: (x: unknown) => unknown }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auth = (req as any).auth as { sub?: string; role?: string };
    if (!auth?.sub || !auth.role) throw new HttpError(401, "Not authenticated");

    const body = castSchema.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid request body");

    const ip = getClientIp(req as any);
    const role = auth.role as "voter" | "admin" | "super_admin";
    const candidateId = body.data.candidateId;
    await castVote({
      env,
      pool,
      authUserId: auth.sub,
      authRole: role,
      candidateId,
      ip,
    });

    const io = (req as any).app?.get?.("io");
    if (io?.to) {
      const snapshot = await createAnalyticsController(env, pool).analytics();
      io.to("admins").emit("dashboard:updated", snapshot);
    }

    res.json({ ok: true });
  }

  return { cast };
}

