import type { Pool } from "pg";
import type { Env } from "../config/env.js";
import { getActiveElection } from "../services/electionService.js";

export function createAnalyticsController(_env: Env, pool: Pool) {
  async function analytics() {
    const election = await getActiveElection(pool);

    const voterTotalRes = await pool.query(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'voter'`);
    const voterTotal = (voterTotalRes.rows[0] as { c: number }).c;

    if (!election) {
      return {
        election: null,
        voterTotal,
        votesTotal: 0,
        turnout: 0,
        candidates: [],
      };
    }

    const votesTotalRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM votes WHERE "timestamp" >= $1 AND "timestamp" <= $2`,
      [election.start_time, election.end_time]
    );
    const votesTotal = (votesTotalRes.rows[0] as { c: number }).c;
    const turnout = voterTotal > 0 ? votesTotal / voterTotal : 0;

    const windowCounts = await pool.query(
      `SELECT candidate_id, COUNT(*)::int AS c
       FROM votes
       WHERE "timestamp" >= $1 AND "timestamp" <= $2
       GROUP BY candidate_id`,
      [election.start_time, election.end_time]
    );

    const countsMap = new Map<string, number>();
    for (const row of windowCounts.rows as Array<{ candidate_id: string; c: number }>) {
      countsMap.set(row.candidate_id, row.c);
    }

    const candidates = await pool.query(`SELECT id, name, party, vote_count FROM candidates ORDER BY name ASC`);
    return {
      election,
      voterTotal,
      votesTotal,
      turnout,
      candidates: (candidates.rows as Array<{
        id: string;
        name: string;
        party: string;
        vote_count: number;
      }>).map((c) => ({
        id: c.id,
        name: c.name,
        party: c.party,
        vote_count_total: c.vote_count,
        vote_count_in_window: countsMap.get(c.id) ?? 0,
      })),
    };
  }

  return { analytics };
}

