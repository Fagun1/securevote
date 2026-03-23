import { Router } from "express";
import type { Pool } from "pg";

export function healthRoutes(pool: Pool): Router {
  const r = Router();

  r.get("/health", async (_req, res, next) => {
    try {
      const client = await pool.connect();
      try {
        await client.query("SELECT 1 AS ok");
      } finally {
        client.release();
      }
      res.json({ ok: true, database: "up" });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
