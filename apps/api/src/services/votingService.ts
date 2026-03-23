import crypto from "node:crypto";
import type { Pool } from "pg";
import type { Env } from "../config/env.js";
import { getActiveElection } from "./electionService.js";
import { encryptAesGcm, parseAes256Key } from "../utils/crypto.js";
import { appendVoteBlock } from "./blockchainService.js";

export async function castVote(params: {
  env: Env;
  pool: Pool;
  authUserId: string;
  authRole: "voter" | "admin" | "super_admin";
  candidateId: string;
  ip: string;
}): Promise<{ ok: true }> {
  const { env, pool, authUserId, candidateId, ip } = params;

  if (params.authRole !== "voter") {
    throw Object.assign(new Error("Only voters can cast votes"), { statusCode: 403 });
  }

  const election = await getActiveElection(pool);
  if (!election) {
    throw Object.assign(new Error("Election is not active"), { statusCode: 403 });
  }

  const aesKey = parseAes256Key(env.VOTE_ENCRYPTION_KEY);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userRes = await client.query(
      `SELECT id, has_voted FROM users WHERE id = $1 FOR UPDATE`,
      [authUserId]
    );
    if (!userRes.rowCount) throw Object.assign(new Error("User not found"), { statusCode: 404 });
    const user = userRes.rows[0] as { id: string; has_voted: boolean };
    if (user.has_voted) throw Object.assign(new Error("User has already voted"), { statusCode: 409 });

    const candRes = await client.query(`SELECT id FROM candidates WHERE id = $1`, [candidateId]);
    if (!candRes.rowCount) throw Object.assign(new Error("Candidate not found"), { statusCode: 404 });

    // Fraud detection: count distinct users who voted from the same IP during the active window.
    const ipFraud = await client.query(
      `SELECT COUNT(DISTINCT user_id)::int AS c
       FROM votes
       WHERE ip = $1 AND "timestamp" >= $2 AND "timestamp" <= $3`,
      [ip || null, election.start_time, election.end_time]
    );
    const ipVoteCount = (ipFraud.rows[0] as { c: number }).c;

    const votePayload = JSON.stringify({
      candidate_id: candidateId,
      election_window_start: election.start_time,
      election_window_end: election.end_time,
      // Server-side nonce to ensure ciphertext changes even for same vote choice.
      nonce: cryptoNonce(),
    });
    const encryptedVote = encryptAesGcm(votePayload, aesKey);

    await client.query(
      `INSERT INTO votes (user_id, candidate_id, encrypted_vote, ip)
       VALUES ($1, $2, $3, $4)`,
      [authUserId, candidateId, encryptedVote, ip || null]
    );

    await client.query(`UPDATE users SET has_voted = TRUE WHERE id = $1`, [authUserId]);
    await client.query(`UPDATE candidates SET vote_count = vote_count + 1 WHERE id = $1`, [candidateId]);

    const block = await appendVoteBlock(env, pool, client, { voterId: authUserId, candidateId });

    // Audit logs
    await client.query(
      `INSERT INTO logs (user_id, action, ip, metadata)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        authUserId,
        "vote_cast",
        ip || null,
        JSON.stringify({
          candidateId,
          electionId: election.id,
          blockIndex: block.index,
        }),
      ]
    );

    if (ipVoteCount >= 2) {
      await client.query(
        `INSERT INTO logs (user_id, action, ip, metadata)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [
          authUserId,
          "suspicious_activity_ip_multiple_voters",
          ip || null,
          JSON.stringify({ ipVoteCount, electionId: election.id }),
        ]
      );
    }

    await client.query("COMMIT");
    return { ok: true };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

function cryptoNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

