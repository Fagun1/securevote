import type { Pool } from "pg";
import type { Env } from "../config/env.js";

export async function listCandidates(pool: Pool) {
  const r = await pool.query(
    `SELECT id, name, party, vote_count
     FROM candidates
     ORDER BY created_at DESC, name ASC`
  );
  return r.rows;
}

export async function createCandidate(
  _env: Env,
  pool: Pool,
  input: { name: string; party: string }
) {
  const r = await pool.query(
    `INSERT INTO candidates (name, party)
     VALUES ($1, $2)
     RETURNING id, name, party, vote_count`,
    [input.name, input.party]
  );
  return r.rows[0];
}

export async function updateCandidate(
  _env: Env,
  pool: Pool,
  id: string,
  input: { name?: string; party?: string }
) {
  const r = await pool.query(
    `UPDATE candidates
     SET name = COALESCE($1, name),
         party = COALESCE($2, party)
     WHERE id = $3
     RETURNING id, name, party, vote_count`,
    [input.name ?? null, input.party ?? null, id]
  );
  if (!r.rowCount) throw Object.assign(new Error("Candidate not found"), { statusCode: 404 });
  return r.rows[0];
}

export async function deleteCandidate(_env: Env, pool: Pool, id: string) {
  const r = await pool.query(`DELETE FROM candidates WHERE id = $1 RETURNING id`, [id]);
  if (!r.rowCount) throw Object.assign(new Error("Candidate not found"), { statusCode: 404 });
  return { ok: true };
}

