import type { Pool, PoolClient } from "pg";
import type { Env } from "../config/env.js";
import { sha256Hex } from "../utils/crypto.js";

export type BlockRow = {
  id: string;
  index: number;
  timestamp: string;
  voter_hash: string;
  candidate_id: string;
  previous_hash: string;
  hash: string;
};

export function computeBlockHash(input: {
  index: number;
  timestampIso: string;
  voterHash: string;
  candidateId: string;
  previousHash: string;
}): string {
  const payload = `${input.index}|${input.timestampIso}|${input.voterHash}|${input.candidateId}|${input.previousHash}`;
  return sha256Hex(payload);
}

export async function appendVoteBlock(
  _env: Env,
  _pool: Pool,
  client: PoolClient,
  input: { voterId: string; candidateId: string }
): Promise<BlockRow> {
  const voterHash = sha256Hex(input.voterId);
  const candidateId = input.candidateId;
  const nowIso = new Date().toISOString();

  // Lock the last block to keep index/previousHash consistent under concurrency.
  const last = await client.query(
    `SELECT id, "index", timestamp, voter_hash, candidate_id, previous_hash, hash
     FROM blockchain
     ORDER BY "index" DESC
     LIMIT 1
     FOR UPDATE`
  );

  const lastRow = last.rowCount ? (last.rows[0] as BlockRow) : null;
  const nextIndex = lastRow ? lastRow.index + 1 : 0;
  const previousHash = lastRow ? lastRow.hash : "GENESIS";

  const hash = computeBlockHash({
    index: nextIndex,
    timestampIso: nowIso,
    voterHash,
    candidateId,
    previousHash,
  });

  const r = await client.query(
    `INSERT INTO blockchain ("index", timestamp, voter_hash, candidate_id, previous_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, "index", timestamp, voter_hash, candidate_id, previous_hash, hash`,
    [nextIndex, nowIso, voterHash, candidateId, previousHash, hash]
  );

  return r.rows[0] as BlockRow;
}

export async function validateChainIntegrity(_env: Env, pool: Pool): Promise<{
  ok: boolean;
  error?: string;
  height?: number;
}> {
  const r = await pool.query(
    `SELECT "index", timestamp, voter_hash, candidate_id, previous_hash, hash
     FROM blockchain
     ORDER BY "index" ASC`
  );
  const rows = r.rows as Array<{
    index: number;
    timestamp: string;
    voter_hash: string;
    candidate_id: string;
    previous_hash: string;
    hash: string;
  }>;

  if (rows.length === 0) return { ok: true, height: 0 };

  let expectedPrev = "GENESIS";
  for (const row of rows) {
    if (row.previous_hash !== expectedPrev) {
      return {
        ok: false,
        error: `Broken previousHash link at index=${row.index}`,
        height: row.index,
      };
    }
    const recomputed = computeBlockHash({
      index: row.index,
      timestampIso: new Date(row.timestamp).toISOString(),
      voterHash: row.voter_hash,
      candidateId: row.candidate_id,
      previousHash: row.previous_hash,
    });
    if (recomputed !== row.hash) {
      return { ok: false, error: `Hash mismatch at index=${row.index}`, height: row.index };
    }
    expectedPrev = row.hash;
  }

  return { ok: true, height: rows[rows.length - 1]!.index };
}

