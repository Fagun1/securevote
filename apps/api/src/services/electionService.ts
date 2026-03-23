import type { Pool } from "pg";
import type { Env } from "../config/env.js";

export type ElectionRow = {
  id: string;
  start_time: string;
  end_time: string;
  is_active: boolean;
};

export async function getActiveElection(pool: Pool): Promise<ElectionRow | null> {
  const r = await pool.query(
    `SELECT id, start_time, end_time, is_active
     FROM election
     WHERE is_active = TRUE AND start_time <= now() AND end_time >= now()
     ORDER BY start_time DESC
     LIMIT 1`
  );
  if (!r.rowCount) return null;
  const row = r.rows[0] as ElectionRow;
  return row;
}

export async function startElection(
  _env: Env,
  pool: Pool,
  input: { endTime: string; startTime?: string }
): Promise<ElectionRow> {
  const startTime = input.startTime ? new Date(input.startTime) : new Date();
  const endTime = new Date(input.endTime);
  if (!(endTime instanceof Date) || Number.isNaN(endTime.getTime())) {
    throw Object.assign(new Error("Invalid end_time"), { statusCode: 400 });
  }
  if (endTime <= startTime) {
    throw Object.assign(new Error("end_time must be after start_time"), { statusCode: 400 });
  }

  try {
    const r = await pool.query(
      `INSERT INTO election (start_time, end_time, is_active)
       VALUES ($1, $2, TRUE)
       RETURNING id, start_time, end_time, is_active`,
      [startTime.toISOString(), endTime.toISOString()]
    );
    return r.rows[0] as ElectionRow;
  } catch (e) {
    // election_one_active is enforced by a partial unique index.
    const any = e as { code?: string };
    if (any.code === "23505") {
      throw Object.assign(new Error("An election is already active"), { statusCode: 409 });
    }
    throw e;
  }
}

export async function endElection(_env: Env, pool: Pool): Promise<ElectionRow> {
  const r = await pool.query(
    `UPDATE election
     SET is_active = FALSE, end_time = LEAST(end_time, now())
     WHERE is_active = TRUE
     RETURNING id, start_time, end_time, is_active`
  );
  if (!r.rowCount) throw Object.assign(new Error("No active election"), { statusCode: 404 });
  return r.rows[0] as ElectionRow;
}

